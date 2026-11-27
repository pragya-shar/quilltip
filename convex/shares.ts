/**
 * Passage share links: `/p/<code>`. A line the author removed or changed is
 * never shown again through a shared link, and a link whose line is gone, or
 * whose article is unpublished or deleted, cannot be told apart from a code
 * that never existed.
 *
 * - `create` snaps a passage to whole sentences on the server. A share made
 *   without an account is one sentence and gets the line's canonical code,
 *   keyed with a server secret, so any number of signed-out people sharing one
 *   line make one row and nobody can compute which lines were shared. A
 *   signed-in share gets a personal code per sharer. Both kinds can exist for
 *   one line and resolve alike; neither says who shared. Signed-out and
 *   signed-in sharing have separate budgets.
 * - `resolve` is called by the `/p/[code]` server component. It answers
 *   `exact` or `moved` with the line's current text, `changed` when the line
 *   still exists but occurs more than once, and the same `null` for an unknown
 *   code, a line that is gone, and an unpublished or deleted article. It never
 *   returns the stored quote or the sharer.
 * - The stored quote exists only to find the sentence again. It is cleared
 *   (with the passage fields) once the line is gone or the article is not
 *   public: by `reconcileArticle`, which the article's publish, edit, unpublish
 *   and delete paths schedule; by `clearIfStale`, which `resolve` schedules;
 *   and by `sweep`, the safety net for a path that missed its call.
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
  rangeOfSentences,
  sentenceRange,
  sentenceRangeText,
  sentencesOf,
  type Sentence,
} from '../lib/passages/sentences'

/** Longest quote a share stores; a longer passage cannot be shared. */
export const MAX_SHARE_QUOTE = 500
/** Articles with more sentences than this cannot be shared from. */
export const MAX_SHAREABLE_SENTENCES = 10_000
export const SHARE_CODE_LENGTH = 8
/** 32 characters: a to z without l and o, and 2 to 9. */
export const SHARE_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
/** Labels the canonical code's keyed hash input. */
export const CANONICAL_CODE_SCHEME = 'quilltip-share-v1'
/**
 * Convex deployment variable: the key of the canonical codes (at least 32
 * characters). Without it, signed-out sharing is refused.
 */
export const SHARE_CODE_SECRET_ENV = 'SHARE_CODE_SECRET'
/** Canonical codes tried for one line before a random code is used. */
export const CANONICAL_GENERATIONS = 16

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Signed in: new codes per person per hour. */
export const SHARES_PER_USER_PER_HOUR = 30
/** Signed in: new codes per article per hour, and in all per hour. */
export const SIGNED_IN_SHARES_PER_ARTICLE_PER_HOUR = 200
export const SIGNED_IN_SHARES_PER_HOUR = 10_000
/** Signed out: new codes per article per day, and in all per day. */
export const SIGNED_OUT_SHARES_PER_ARTICLE_PER_DAY = 500
export const SIGNED_OUT_SHARES_PER_DAY = 50_000
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
        /** Normalized, at most `MAX_SHARE_QUOTE` characters. */
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

/** The canonical-code key, or null when the deployment has none. */
export function shareCodeSecret(): string | null {
  const secret = process.env[SHARE_CODE_SECRET_ENV]?.trim()
  return secret && secret.length >= 32 ? secret : null
}

/**
 * Generation `n` of a line's canonical code: HMAC-SHA-256 keyed with the
 * deployment's secret over the scheme, article id, passage id and generation.
 */
export async function canonicalCode(
  secret: string,
  articleId: string,
  passageId: string,
  generation: number
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(
      `${CANONICAL_CODE_SCHEME}\n${articleId}\n${passageId}\n${generation}`
    ) as BufferSource
  )
  return codeFromBytes(new Uint8Array(mac))
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
  | { status: 'gone' }

/**
 * Where a share's quote is in the current text. `exact`: found exactly once
 * at its stored sentences (or, at the same content version, at its stored
 * sentences among several). `moved`: found exactly once elsewhere. `changed`:
 * found more than once, so the line exists but cannot be told apart. `gone`:
 * not found word for word (removed, edited, or only a near match).
 */
function locate(
  share: Doc<'shares'>,
  article: Doc<'articles'>,
  sentences: Sentence[]
): Located {
  const quote = share.quote
  if (quote === null) return { status: 'gone' }
  const found = findPassage(sentences, quote)
  const stored = (f: [number, number]) =>
    f[0] === share.sentenceStart && f[1] === share.sentenceEnd
  if (found.length === 1) {
    const [from, to] = found[0]!
    return { status: stored(found[0]!) ? 'exact' : 'moved', from, to }
  }
  if (found.length === 0) return { status: 'gone' }
  const here = found.find(stored)
  if (here && (article.contentVersion ?? null) === share.contentVersion) {
    return { status: 'exact', from: here[0], to: here[1] }
  }
  return { status: 'changed' }
}

async function consumeLimits(
  ctx: MutationCtx,
  limits: Array<{ key: string; limit: number; windowMs: number }>,
  now: number
): Promise<void> {
  for (const { key, limit, windowMs } of limits) {
    const result = await consumeFixedWindow(ctx, key, limit, windowMs, now)
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

async function freeRandomCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    if (!(await codeTaken(ctx, code))) return code
  }
  throw new ConvexError({ code: 'CODE_UNAVAILABLE' })
}

/**
 * Creates a share for a passage of a published article and returns its code.
 * Errors (`ConvexError` data `code`): `NOT_FOUND` (missing or unpublished,
 * alike), `ARTICLE_TOO_LONG` (with `maxSentences`), `INVALID_PASSAGE`,
 * `SINGLE_SENTENCE_ONLY` (signed out, more than one sentence),
 * `PASSAGE_TOO_LONG` (with `max`), `SHARING_NOT_CONFIGURED` (signed out, no
 * secret), `RATE_LIMITED` (with `retryAfterMs`). A quote is never shortened.
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
    if (sentences.length > MAX_SHAREABLE_SENTENCES) {
      throw new ConvexError({
        code: 'ARTICLE_TOO_LONG',
        maxSentences: MAX_SHAREABLE_SENTENCES,
      })
    }
    const range = sentenceRange(
      sentences,
      args.passage.startOffset,
      args.passage.endOffset
    )
    if (!range) throw new ConvexError({ code: 'INVALID_PASSAGE' })
    const userId = await getAuthUserId(ctx)
    if (!userId && range.sentenceEnd !== range.sentenceStart) {
      throw new ConvexError({ code: 'SINGLE_SENTENCE_ONLY' })
    }
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
          {
            key: `shares:user:${userId}`,
            limit: SHARES_PER_USER_PER_HOUR,
            windowMs: HOUR_MS,
          },
          {
            key: `shares:signed-in:article:${article._id}`,
            limit: SIGNED_IN_SHARES_PER_ARTICLE_PER_HOUR,
            windowMs: HOUR_MS,
          },
          {
            key: 'shares:signed-in:all',
            limit: SIGNED_IN_SHARES_PER_HOUR,
            windowMs: HOUR_MS,
          },
        ],
        now
      )
      const code = await freeRandomCode(ctx)
      await ctx.db.insert('shares', {
        ...row,
        code,
        kind: 'personal',
        createdBy: userId,
      })
      return { code }
    }

    // Signed out: one canonical row per line; an existing one costs no write.
    const existing = await ctx.db
      .query('shares')
      .withIndex('by_article_passage_sharer', (q) =>
        q
          .eq('articleId', article._id)
          .eq('passageId', passageId)
          .eq('createdBy', undefined)
      )
      .first()
    if (existing) return { code: existing.code }
    const secret = shareCodeSecret()
    if (!secret) throw new ConvexError({ code: 'SHARING_NOT_CONFIGURED' })
    await consumeLimits(
      ctx,
      [
        {
          key: `shares:signed-out:article:${article._id}`,
          limit: SIGNED_OUT_SHARES_PER_ARTICLE_PER_DAY,
          windowMs: DAY_MS,
        },
        {
          key: 'shares:signed-out:all',
          limit: SIGNED_OUT_SHARES_PER_DAY,
          windowMs: DAY_MS,
        },
      ],
      now
    )
    let code: string | null = null
    for (let n = 0; n < CANONICAL_GENERATIONS && code === null; n++) {
      const candidate = await canonicalCode(
        secret,
        String(article._id),
        passageId,
        n
      )
      // A generation held by a cleared row, or by another line, is skipped.
      if (!(await codeTaken(ctx, candidate))) code = candidate
    }
    code ??= await freeRandomCode(ctx)
    await ctx.db.insert('shares', { ...row, code, kind: 'canonical' })
    return { code }
  },
})

/**
 * Resolves a share code for the `/p/[code]` server component. It returns
 * nothing that the public page does not show, and the same `null` for an
 * unknown or malformed code, a line that is gone, and an unpublished or
 * deleted article. It writes nothing; for a line it finds gone it schedules
 * `clearIfStale` (the hooks and the sweep clear shares of hidden articles).
 */
export const resolve = mutation({
  args: { code: v.string() },
  returns: resolvedValidator,
  handler: async (ctx, args) => {
    const code = args.code.slice(0, 64).trim().toLowerCase()
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
    if (!share || !isPublic(article)) return null

    const canonical = canonicalText(article.content)
    const sentences = sentencesOf(canonical)
    const located = locate(share, article, sentences)
    if (located.status === 'gone') {
      if (share.quote !== null || share.passageId !== null) {
        await ctx.scheduler.runAfter(0, internal.shares.clearIfStale, {
          shareId: share._id,
        })
      }
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
    if (located.status === 'changed') {
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
        text: sentenceRangeText(
          sentences,
          range.sentenceStart,
          range.sentenceEnd
        ).slice(0, MAX_SHARE_QUOTE),
      },
    }
  },
})

/** Clears one share when its line is gone or its article is not public. */
export const clearIfStale = internalMutation({
  args: { shareId: v.id('shares') },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const share = await ctx.db.get(args.shareId)
    if (!share) return false
    const article = await ctx.db.get(share.articleId)
    if (
      isPublic(article) &&
      locate(share, article, sentencesOf(canonicalText(article.content)))
        .status !== 'gone'
    ) {
      return false
    }
    return clearShare(ctx, share, Date.now())
  },
})

/**
 * Clears every share of an article whose line is gone (all of them when the
 * article is unpublished or deleted), and marks the others checked. Bounded
 * batches; schedules itself until the article's rows are done.
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
      .withIndex('by_article_passage_sharer', (q) =>
        q.eq('articleId', args.articleId)
      )
      .paginate({ numItems: RECONCILE_BATCH, cursor: args.cursor ?? null })
    const now = Date.now()
    let cleared = 0
    for (const share of page.page) {
      if (share.quote === null && share.passageId === null) continue
      if (live && locate(share, live, sentences).status !== 'gone') {
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
        if (locate(share, article, entry.sentences).status !== 'gone') {
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
    .withIndex('by_article_passage_sharer', (q) => q.eq('articleId', articleId))
    .first()
  if (!any) return
  await ctx.scheduler.runAfter(0, internal.shares.reconcileArticle, {
    articleId,
  })
}
