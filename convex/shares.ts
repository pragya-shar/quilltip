/**
 * Passage share links: `/p/<code>` (architecture slice-2.md section 3, D17).
 *
 * - `create` snaps a passage to whole sentences on the server and returns the
 *   existing code for the same passage or a new one. Rate limited.
 * - `resolve` is called by the `/p/[code]` server component. It answers
 *   `exact`, `moved` or `changed`, and `null` alike for an unknown code and
 *   for an article that is unpublished or gone. It never returns the stored
 *   quote; a passage's text always comes from the current published article.
 * - The stored quote exists only to find the sentence again. It is cleared
 *   (with the passage fields) once it no longer matches the published text:
 *   by `reconcileArticle`, which the article's publish, edit, unpublish and
 *   delete paths schedule, and by `resolve` itself.
 */
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from './_generated/server'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import {
  canonicalText,
  findPassage,
  identifyRange,
  passageText,
  rangeOfSentences,
  sentenceRange,
  sentenceRangeText,
  sentencesOf,
  type Sentence,
} from '../lib/passages/sentences'

/** Longest quote a share stores; a longer passage cannot be shared. */
export const MAX_SHARE_QUOTE = 500
export const SHARE_CODE_LENGTH = 8
/** 32 characters: a to z without l and o, and 2 to 9. */
export const SHARE_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const SHARE_CODE_PATTERN = new RegExp(
  `^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`
)

const HOUR_MS = 60 * 60 * 1000
/** New share rows per signed-in person per hour. */
export const SHARES_PER_USER_PER_HOUR = 30
/** New share rows from all signed-out callers together per hour. */
export const SHARES_SIGNED_OUT_PER_HOUR = 300
/** New share rows per article per hour. */
export const SHARES_PER_ARTICLE_PER_HOUR = 200
/** Rows one reconcile run reads before it schedules the next. */
export const RECONCILE_BATCH = 100

/** A selection in the article's canonical offsets (`canonicalText`). */
export const passageRefValidator = v.object({
  startOffset: v.number(),
  endOffset: v.number(),
})

const resolvedValidator = v.union(
  v.null(),
  v.object({
    status: v.union(
      v.literal('exact'),
      v.literal('moved'),
      v.literal('changed')
    ),
    article: v.object({
      id: v.id('articles'),
      slug: v.string(),
      title: v.string(),
      writerName: v.string(),
      href: v.string(),
    }),
    passage: v.union(
      v.null(),
      v.object({
        passageId: v.string(),
        sentenceStart: v.number(),
        sentenceEnd: v.number(),
        startOffset: v.number(),
        endOffset: v.number(),
        text: v.string(),
      })
    ),
  })
)

/** The only state in which a share resolves to its article. */
function isPublic(article: Doc<'articles'> | null): article is Doc<'articles'> {
  return article !== null && article.published === true
}

function newCode(): string {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const b of bytes) code += SHARE_CODE_ALPHABET[b % 32]
  return code
}

async function clearShare(
  ctx: MutationCtx,
  share: Doc<'shares'>,
  now: number
): Promise<void> {
  if (share.quote === null && share.passageId === null) return
  await ctx.db.patch(share._id, {
    quote: null,
    passageId: null,
    sentenceStart: null,
    sentenceEnd: null,
    clearedAt: now,
  })
}

type Located =
  | { status: 'exact' | 'moved'; from: number; to: number }
  | { status: 'changed' }

/**
 * Where a share's quote is in the current text. `exact`: the same content
 * version and the quote still at its sentences. `moved`: the article changed
 * and the quote occurs exactly once. Anything else is `changed`: no match, a
 * near match, or more than one match.
 */
function locate(
  share: Doc<'shares'>,
  article: Doc<'articles'>,
  sentences: Sentence[]
): Located {
  const quote = share.quote
  if (quote === null) return { status: 'changed' }
  const version = article.contentVersion ?? null
  const from = share.sentenceStart
  const to = share.sentenceEnd
  if (
    version === share.contentVersion &&
    from !== null &&
    to !== null &&
    to < sentences.length &&
    sentenceRangeText(sentences, from, to) === quote
  ) {
    return { status: 'exact', from, to }
  }
  const found = findPassage(sentences, quote)
  const only = found.length === 1 ? found[0] : undefined
  if (!only) return { status: 'changed' }
  return { status: 'moved', from: only[0], to: only[1] }
}

/** Creates a share for a passage of a published article. */
export const create = mutation({
  args: { articleId: v.id('articles'), passage: passageRefValidator },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!isPublic(article)) {
      throw new ConvexError({ code: 'NOT_FOUND' })
    }
    const canonical = canonicalText(article.content)
    const sentences = sentencesOf(canonical)
    const range = sentenceRange(
      sentences,
      args.passage.startOffset,
      args.passage.endOffset
    )
    if (!range) throw new ConvexError({ code: 'INVALID_PASSAGE' })
    const quote = sentenceRangeText(
      sentences,
      range.sentenceStart,
      range.sentenceEnd
    )
    if (quote.length > MAX_SHARE_QUOTE) {
      throw new ConvexError({ code: 'PASSAGE_TOO_LONG', max: MAX_SHARE_QUOTE })
    }
    const identity = await identifyRange(
      String(article._id),
      canonical,
      sentences,
      range
    )

    const existing = await ctx.db
      .query('shares')
      .withIndex('by_article_passage', (q) =>
        q.eq('articleId', article._id).eq('passageId', identity.passageId)
      )
      .first()
    if (existing && existing.quote !== null) return { code: existing.code }

    const now = Date.now()
    const userId = await getAuthUserId(ctx)
    const limits: Array<{ key: string; limit: number }> = [
      userId
        ? { key: `shares:user:${userId}`, limit: SHARES_PER_USER_PER_HOUR }
        : { key: 'shares:signed-out', limit: SHARES_SIGNED_OUT_PER_HOUR },
      {
        key: `shares:article:${article._id}`,
        limit: SHARES_PER_ARTICLE_PER_HOUR,
      },
    ]
    for (const { key, limit } of limits) {
      const result = await consumeFixedWindow(ctx, key, limit, HOUR_MS, now)
      if (!result.ok) {
        throw new ConvexError({
          code: 'RATE_LIMITED',
          retryAfterMs: result.retryAfterMs,
        })
      }
    }

    let code = newCode()
    for (let attempt = 0; ; attempt++) {
      const taken = await ctx.db
        .query('shares')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (!taken) break
      if (attempt >= 4) throw new Error('Could not allocate a share code')
      code = newCode()
    }
    await ctx.db.insert('shares', {
      code,
      articleId: article._id,
      passageId: identity.passageId,
      sentenceStart: range.sentenceStart,
      sentenceEnd: range.sentenceEnd,
      quote,
      contentVersion: article.contentVersion ?? null,
      ...(userId ? { createdBy: userId } : {}),
      createdAt: now,
    })
    return { code }
  },
})

/**
 * Resolves a share code for the `/p/[code]` server component. A mutation so
 * that a quote found stale is cleared in the same transaction. It returns
 * nothing that the public page does not show, and the same `null` for an
 * unknown code and for an article that is unpublished or deleted.
 */
export const resolve = mutation({
  args: { code: v.string() },
  returns: resolvedValidator,
  handler: async (ctx, args) => {
    const code = args.code.trim().toLowerCase()
    const share = SHARE_CODE_PATTERN.test(code)
      ? await ctx.db
          .query('shares')
          .withIndex('by_code', (q) => q.eq('code', code))
          .first()
      : null
    const article = share ? await ctx.db.get(share.articleId) : null
    if (!share || !isPublic(article)) {
      if (share) await clearShare(ctx, share, Date.now())
      return null
    }

    const author = await ctx.db.get(article.authorId)
    const username = author?.username ?? article.authorUsername
    const summary = {
      id: article._id,
      slug: article.slug,
      title: article.title,
      writerName: author?.name ?? article.authorName ?? username,
      href: `/${username}/${article.slug}`,
    }

    const canonical = canonicalText(article.content)
    const sentences = sentencesOf(canonical)
    const located = locate(share, article, sentences)
    if (located.status === 'changed') {
      await clearShare(ctx, share, Date.now())
      return { status: 'changed' as const, article: summary, passage: null }
    }
    const range = rangeOfSentences(sentences, located.from, located.to)!
    const identity = await identifyRange(
      String(article._id),
      canonical,
      sentences,
      range
    )
    return {
      status: located.status,
      article: summary,
      passage: {
        passageId: identity.passageId,
        sentenceStart: range.sentenceStart,
        sentenceEnd: range.sentenceEnd,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        text: passageText(canonical, range.startOffset, range.endOffset),
      },
    }
  },
})

/**
 * Clears every share of an article whose quote no longer matches its
 * published text (all of them when the article is unpublished or deleted).
 * Bounded batches; schedules itself until the article's rows are done.
 */
export const reconcileArticle = internalMutation({
  args: {
    articleId: v.id('articles'),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ cleared: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    const live = isPublic(article) ? article : null
    const sentences = live ? sentencesOf(canonicalText(live.content)) : []
    const page = await ctx.db
      .query('shares')
      .withIndex('by_article_passage', (q) => q.eq('articleId', args.articleId))
      .paginate({ numItems: RECONCILE_BATCH, cursor: args.cursor ?? null })
    const now = Date.now()
    let cleared = 0
    for (const share of page.page) {
      if (share.quote === null && share.passageId === null) continue
      if (live && locate(share, live, sentences).status !== 'changed') continue
      await clearShare(ctx, share, now)
      cleared++
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.shares.reconcileArticle, {
        articleId: args.articleId,
        cursor: page.continueCursor,
      })
    }
    return { cleared, done: page.isDone }
  },
})

/**
 * Called by the article mutations that change what is published (publish,
 * edit, unpublish, delete). Schedules `reconcileArticle` when the article has
 * any share row; costs one indexed read otherwise.
 */
export async function scheduleShareReconcile(
  ctx: MutationCtx,
  articleId: Id<'articles'>
): Promise<void> {
  const any = await ctx.db
    .query('shares')
    .withIndex('by_article_passage', (q) => q.eq('articleId', articleId))
    .first()
  if (!any) return
  await ctx.scheduler.runAfter(0, internal.shares.reconcileArticle, {
    articleId,
  })
}
