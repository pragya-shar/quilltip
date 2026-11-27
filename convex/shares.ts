/**
 * Passage share links: `/p/<code>`. A line the author removed or changed is
 * never shown again through a shared link, and a link to an unpublished or
 * deleted article cannot be told apart from a code that never existed.
 *
 * - `create` snaps a passage to whole sentences on the server. A share made
 *   without an account gets the line's canonical code (derived from the
 *   article and the passage), so any number of signed-out people sharing one
 *   line make one row. A signed-in share gets a personal code per sharer.
 *   Both kinds of code can exist for the same line and resolve alike; neither
 *   says who shared, and `resolve` never returns the sharer.
 * - `resolve` is called by the `/p/[code]` server component. It answers
 *   `exact`, `moved` or `changed`, and the same `null` for an unknown code and
 *   for an article that is unpublished or gone. It never returns the stored
 *   quote; a passage's text always comes from the current published article.
 *   It writes only when it finds a stale quote.
 * - The stored quote exists only to find the sentence again. It is cleared
 *   (with the passage fields) once it no longer matches the published text:
 *   by `reconcileArticle`, which the article's publish, edit, unpublish and
 *   delete paths schedule; by `resolve`; and by `sweep`, the safety net for a
 *   path that missed its call.
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
/** Labels the canonical code's hash input. */
export const CANONICAL_CODE_SCHEME = 'quilltip-share-v1'
/**
 * Canonical codes tried for one line: generation 0 first; a generation whose
 * row was cleared, or whose code another row holds, is skipped.
 */
export const CANONICAL_GENERATIONS = 16

const HOUR_MS = 60 * 60 * 1000
/** New personal codes per signed-in person per hour. */
export const SHARES_PER_USER_PER_HOUR = 30
/** New share rows per article per hour, both kinds. */
export const SHARES_PER_ARTICLE_PER_HOUR = 200
/** New share rows in all per hour: a bound on table growth. */
export const SHARES_PER_HOUR = 10_000
/** Rows one reconcile or sweep step reads. */
export const RECONCILE_BATCH = 100
/** Sweep steps chained from one cron run. */
export const SWEEP_STEPS_PER_RUN = 10

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

function codeFromBytes(bytes: Uint8Array): string {
  let code = ''
  for (let i = 0; i < SHARE_CODE_LENGTH; i++)
    code += SHARE_CODE_ALPHABET[bytes[i]! % 32]
  return code
}

function randomCode(): string {
  const bytes = new Uint8Array(SHARE_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return codeFromBytes(bytes)
}

/** Generation `n` of a line's canonical code. */
export async function canonicalCode(
  articleId: string,
  passageId: string,
  generation: number
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `${CANONICAL_CODE_SCHEME}\n${articleId}\n${passageId}\n${generation}`
    ) as BufferSource
  )
  return codeFromBytes(new Uint8Array(digest))
}

async function clearShare(
  ctx: MutationCtx,
  share: Doc<'shares'>,
  now: number
): Promise<boolean> {
  if (share.quote === null && share.passageId === null) return false
  await ctx.db.patch(share._id, {
    quote: null,
    passageId: null,
    sentenceStart: null,
    sentenceEnd: null,
    clearedAt: now,
    checkedAt: now,
  })
  return true
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

async function consumeLimits(
  ctx: MutationCtx,
  limits: Array<{ key: string; limit: number }>,
  now: number
): Promise<void> {
  for (const { key, limit } of limits) {
    const result = await consumeFixedWindow(ctx, key, limit, HOUR_MS, now)
    if (!result.ok) {
      throw new ConvexError({
        code: 'RATE_LIMITED',
        retryAfterMs: result.retryAfterMs,
      })
    }
  }
}

async function codeTaken(ctx: MutationCtx, code: string) {
  return ctx.db
    .query('shares')
    .withIndex('by_code', (q) => q.eq('code', code))
    .first()
}

/**
 * Creates a share for a passage of a published article and returns its code.
 * Errors (`ConvexError` data): `NOT_FOUND` (missing or unpublished, alike),
 * `INVALID_PASSAGE`, `PASSAGE_TOO_LONG` (with `max`), `RATE_LIMITED` (with
 * `retryAfterMs`). A quote is never shortened to fit.
 */
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
    const { passageId } = await identifyRange(
      String(article._id),
      canonical,
      sentences,
      range
    )
    const now = Date.now()
    const userId = await getAuthUserId(ctx)
    const growth = [
      {
        key: `shares:article:${article._id}`,
        limit: SHARES_PER_ARTICLE_PER_HOUR,
      },
      { key: 'shares:all', limit: SHARES_PER_HOUR },
    ]
    const row = {
      articleId: article._id,
      passageId,
      sentenceStart: range.sentenceStart,
      sentenceEnd: range.sentenceEnd,
      quote,
      contentVersion: article.contentVersion ?? null,
      createdAt: now,
      checkedAt: now,
    }

    if (userId) {
      const mine = await ctx.db
        .query('shares')
        .withIndex('by_article_passage_sharer', (q) =>
          q
            .eq('articleId', article._id)
            .eq('passageId', passageId)
            .eq('createdBy', userId)
        )
        .first()
      if (mine) return { code: mine.code }
      await consumeLimits(
        ctx,
        [
          { key: `shares:user:${userId}`, limit: SHARES_PER_USER_PER_HOUR },
          ...growth,
        ],
        now
      )
      let code = randomCode()
      for (let attempt = 0; await codeTaken(ctx, code); attempt++) {
        if (attempt >= 4) throw new Error('Could not allocate a share code')
        code = randomCode()
      }
      await ctx.db.insert('shares', {
        ...row,
        code,
        kind: 'personal',
        createdBy: userId,
      })
      return { code }
    }

    for (let generation = 0; generation < CANONICAL_GENERATIONS; generation++) {
      const code = await canonicalCode(
        String(article._id),
        passageId,
        generation
      )
      const holder = await codeTaken(ctx, code)
      if (!holder) {
        await consumeLimits(ctx, growth, now)
        await ctx.db.insert('shares', { ...row, code, kind: 'canonical' })
        return { code }
      }
      if (
        holder.kind === 'canonical' &&
        holder.articleId === article._id &&
        holder.passageId === passageId
      ) {
        return { code }
      }
      // Cleared, or another line's code: the next generation.
    }
    throw new Error('Could not allocate a share code')
  },
})

/**
 * Resolves a share code for the `/p/[code]` server component. A mutation so
 * that a quote found stale is cleared in the same transaction; on every other
 * path it writes nothing. It returns nothing that the public page does not
 * show. Unknown, malformed, unpublished and deleted all do one share lookup
 * and one article read and return the same `null`.
 */
export const resolve = mutation({
  args: { code: v.string() },
  returns: resolvedValidator,
  handler: async (ctx, args) => {
    const code = args.code.trim().toLowerCase().slice(0, 64)
    const share = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    const article = share
      ? await ctx.db.get(share.articleId)
      : // The same read an existing code makes, with nothing to find.
        await ctx.db
          .query('articles')
          .withIndex('by_slug', (q) => q.eq('slug', ''))
          .first()
          .then(() => null)
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
 * published text (all of them when the article is unpublished or deleted),
 * and marks the others checked. Bounded batches; schedules itself until the
 * article's rows are done.
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
      if (live && locate(share, live, sentences).status !== 'changed') {
        if (share.checkedAt < now)
          await ctx.db.patch(share._id, { checkedAt: now })
        continue
      }
      if (await clearShare(ctx, share, now)) cleared++
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
 * Safety net for a path that changed an article without calling
 * `scheduleShareReconcile`. Walks every share in creation order, a bounded
 * page per step and `SWEEP_STEPS_PER_RUN` steps per cron run, and re-checks a
 * share only when its article is no longer public or changed after the
 * share's `checkedAt`. Writes only a clear, a `checkedAt` after a re-check,
 * and its own position; with no shares it writes nothing.
 */
export const sweep = internalMutation({
  args: { steps: v.optional(v.number()) },
  returns: v.object({
    seen: v.number(),
    rechecked: v.number(),
    cleared: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query('shareSweeps')
      .withIndex('by_key', (q) => q.eq('key', 'shares'))
      .unique()
    const read = (cursor: string | null) =>
      ctx.db.query('shares').paginate({ numItems: RECONCILE_BATCH, cursor })
    // A position saved before a schema or index change may no longer be a
    // valid cursor: start the pass again instead of failing every run.
    const page = await read(state?.cursor ?? null).catch(() => read(null))
    const now = Date.now()
    const articles = new Map<
      Id<'articles'>,
      { article: Doc<'articles'> | null; sentences: Sentence[] | null }
    >()
    let rechecked = 0
    let cleared = 0
    for (const share of page.page) {
      if (share.quote === null && share.passageId === null) continue
      let entry = articles.get(share.articleId)
      if (!entry) {
        entry = { article: await ctx.db.get(share.articleId), sentences: null }
        articles.set(share.articleId, entry)
      }
      const article = entry.article
      if (isPublic(article) && article.updatedAt <= share.checkedAt) continue
      rechecked++
      if (isPublic(article)) {
        entry.sentences ??= sentencesOf(canonicalText(article.content))
        if (locate(share, article, entry.sentences).status !== 'changed') {
          await ctx.db.patch(share._id, { checkedAt: now })
          continue
        }
      }
      if (await clearShare(ctx, share, now)) cleared++
    }

    const cursor = page.isDone ? null : page.continueCursor
    if (state) {
      if (state.cursor !== cursor || page.page.length > 0)
        await ctx.db.patch(state._id, {
          cursor,
          lastRunAt: now,
          ...(page.isDone ? { lastPassAt: now } : {}),
        })
    } else if (page.page.length > 0) {
      await ctx.db.insert('shareSweeps', {
        key: 'shares',
        cursor,
        lastRunAt: now,
        ...(page.isDone ? { lastPassAt: now } : {}),
      })
    }
    const steps = args.steps ?? SWEEP_STEPS_PER_RUN
    if (!page.isDone && steps > 1) {
      await ctx.scheduler.runAfter(0, internal.shares.sweep, {
        steps: steps - 1,
      })
    }
    return {
      seen: page.page.length,
      rechecked,
      cleared,
      done: page.isDone,
    }
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
