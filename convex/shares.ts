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
 *   and by `sweep`, the safety net for a path that missed its call. The sweep
 *   deletes a cleared row `CLEARED_SHARE_RETENTION_MS` after it was cleared
 *   and keeps its code in `retiredShareCodes`, so neither the random codes
 *   nor another line's canonical code can ever reuse it.
 * - Every path that reads an article's text (`create`, `resolve`,
 *   `clearIfStale`, `reconcileArticle`, `sweep`) first checks its size
 *   (`readShareable`): past `MAX_SHAREABLE_CHARACTERS`,
 *   `MAX_SHAREABLE_BREAKS` or `MAX_SHAREABLE_SENTENCES`, or with a run of
 *   more than `MAX_COMBINING_MARK_RUN` combining marks, the article is not
 *   searched. `create` refuses it, `resolve` answers null without clearing,
 *   and the clean-up paths leave its shares as they are.
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
  hasLongCombiningRun,
  identifyRange,
  passageIndexOf,
  passageMatchesAt,
  rangeOfSentences,
  sentenceRange,
  sentenceRangeText,
  sentencesOf,
  type CanonicalText,
  type PassageIndex,
  type Sentence,
} from '../lib/passages/sentences'

/** Longest quote a share stores; a longer passage cannot be shared. */
export const MAX_SHARE_QUOTE = 500
/**
 * An article past any of these is not searched for shares: its text in
 * UTF-16 units, its hard breaks (and other inline non-text nodes), its
 * sentences. Each search then costs at most about these sizes.
 */
export const MAX_SHAREABLE_CHARACTERS = 200_000
export const MAX_SHAREABLE_BREAKS = 10_000
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
/** The documented placeholders (`.env.example`, now and before), never keys. */
export const SHARE_CODE_SECRET_PLACEHOLDERS: readonly string[] = [
  'replace-with-a-random-secret',
  'replace-with-at-least-32-random-characters',
]
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
/**
 * Full pages one cron run walks (steps that stop early at the article budget
 * are not counted), and cron runs a day (`convex/crons.ts`, hourly).
 */
export const SWEEP_STEPS_PER_RUN = 25
export const SWEEP_RUNS_PER_DAY = 24
/**
 * Rows the sweep walks a day: 24 × 25 × 100 = 60,000, above the 50,000 new
 * signed-out rows a day allows, so a pass keeps up with signed-out sharing.
 */
export const SWEEP_ROWS_PER_DAY =
  SWEEP_RUNS_PER_DAY * SWEEP_STEPS_PER_RUN * RECONCILE_BATCH
/**
 * Distinct articles one sweep step reads; the step stops at the next one and
 * the following step resumes at that share.
 */
export const SWEEP_ARTICLES_PER_STEP = 8
/**
 * How long a cleared row is kept before the sweep deletes it: 30 days. Its
 * code then moves to `retiredShareCodes`, so it is never issued again.
 */
export const CLEARED_SHARE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

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
  if (!secret || secret.length < 32) return null
  return SHARE_CODE_SECRET_PLACEHOLDERS.includes(secret) ? null : secret
}

/** An article's text, ready to search. */
type Shareable = {
  canonical: CanonicalText
  sentences: Sentence[]
  index: PassageIndex
}

/**
 * The article's sentences and search index, or null when the article is past
 * a size limit (checked before the sentences are split).
 */
export function readShareable(content: unknown): Shareable | null {
  const canonical = canonicalText(content)
  if (canonical.text.length > MAX_SHAREABLE_CHARACTERS) return null
  // Before any NFC: normalising a long run of combining marks is quadratic.
  if (hasLongCombiningRun(canonical.text)) return null
  let breaks = 0
  for (const block of canonical.blocks) breaks += block.gaps.length
  if (breaks > MAX_SHAREABLE_BREAKS) return null
  const sentences = sentencesOf(canonical)
  if (sentences.length > MAX_SHAREABLE_SENTENCES) return null
  return { canonical, sentences, index: passageIndexOf(sentences) }
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
  text: Shareable
): Located {
  const quote = share.quote
  if (quote === null) return { status: 'gone' }
  const found = findPassage(text.index, quote, 2)
  if (found.length === 0) return { status: 'gone' }
  if (found.length === 1) {
    const [from, to] = found[0]!
    const stored = from === share.sentenceStart && to === share.sentenceEnd
    return { status: stored ? 'exact' : 'moved', from, to }
  }
  const { sentenceStart, sentenceEnd } = share
  if (
    sentenceStart !== null &&
    sentenceEnd !== null &&
    (article.contentVersion ?? null) === share.contentVersion &&
    passageMatchesAt(text.index, quote, sentenceStart, sentenceEnd)
  ) {
    return { status: 'exact', from: sentenceStart, to: sentenceEnd }
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

/** A code is taken while a share row or a retired code holds it. */
async function codeTaken(ctx: MutationCtx, code: string): Promise<boolean> {
  const live = await ctx.db
    .query('shares')
    .withIndex('by_code', (q) => q.eq('code', code))
    .first()
  if (live) return true
  const retired = await ctx.db
    .query('retiredShareCodes')
    .withIndex('by_code', (q) => q.eq('code', code))
    .first()
  return retired !== null
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
 * secret), `RATE_LIMITED` (with `retryAfterMs`). `ARTICLE_TOO_LONG` also
 * carries `maxCharacters` and `maxBreaks`. A quote is never shortened.
 */
export const create = mutation({
  args: { articleId: v.id('articles'), passage: passageRefValidator },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!isPublic(article)) {
      throw new ConvexError({ code: 'NOT_FOUND' })
    }
    const text = readShareable(article.content)
    if (!text) {
      throw new ConvexError({
        code: 'ARTICLE_TOO_LONG',
        maxSentences: MAX_SHAREABLE_SENTENCES,
        maxCharacters: MAX_SHAREABLE_CHARACTERS,
        maxBreaks: MAX_SHAREABLE_BREAKS,
      })
    }
    const { canonical, sentences, index } = text
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
      range,
      index
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
 * deleted article. A cleared row is read as an unknown code: the same reads,
 * and no article work. It writes nothing; for a line it finds gone it
 * schedules `clearIfStale` (the hooks and the sweep clear shares of hidden
 * articles). An article past the size limits answers null and is not cleared.
 */
export const resolve = mutation({
  args: { code: v.string() },
  returns: resolvedValidator,
  handler: async (ctx, args) => {
    const code = args.code.slice(0, 64).trim().toLowerCase()
    const row = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    // A cleared row answers exactly as an unknown code does.
    const share = row && row.quote !== null ? row : null
    const article = share
      ? await ctx.db.get(share.articleId)
      : // The same read an existing code makes, with nothing to find.
        await ctx.db
          .query('articles')
          .withIndex('by_slug', (q) => q.eq('slug', ''))
          .first()
          .then(() => null)
    if (!share || !isPublic(article)) return null

    const text = readShareable(article.content)
    if (!text) return null
    const { canonical, sentences, index } = text
    const located = locate(share, article, text)
    if (located.status === 'gone') {
      await ctx.scheduler.runAfter(0, internal.shares.clearIfStale, {
        shareId: share._id,
      })
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
      range,
      index
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
    if (isPublic(article)) {
      const text = readShareable(article.content)
      // Past the size limits: left as it is, like every other path.
      if (!text || locate(share, article, text).status !== 'gone') return false
    }
    return clearShare(ctx, share, Date.now())
  },
})

/**
 * Clears every share of an article whose line is gone (all of them when the
 * article is unpublished or deleted), and marks the others checked. Bounded
 * batches; schedules itself until the article's rows are done. A public
 * article past the size limits is not searched: its shares are only marked
 * checked.
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
    const text = live ? readShareable(live.content) : null
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
      if (live && (!text || locate(share, live, text).status !== 'gone')) {
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
 * `scheduleShareReconcile`, and the clean-up of old cleared rows. Walks every
 * share in creation order, a page of `RECONCILE_BATCH` rows per step and
 * `SWEEP_STEPS_PER_RUN` steps per cron run. It re-checks a share only when
 * its article is no longer public or changed after the share's `checkedAt`,
 * and deletes a row cleared more than `CLEARED_SHARE_RETENTION_MS` ago.
 *
 * Bounded per step: at most `SWEEP_ARTICLES_PER_STEP` distinct articles are
 * read; at the next one the step ends and the next step resumes at that share
 * (`resumeAfter`). An article past the size limits is skipped, and one whose
 * check throws is recorded (`failures`, `lastFailedArticleId`): either way its
 * shares are marked checked and the walk goes on, so no article can hold up
 * the shares after it.
 *
 * Writes: a clear, a delete, a `checkedAt`, and its own position on every
 * step that read a share (none when there are no shares).
 */
export const sweep = internalMutation({
  args: { steps: v.optional(v.number()) },
  returns: v.object({
    seen: v.number(),
    rechecked: v.number(),
    cleared: v.number(),
    purged: v.number(),
    skipped: v.number(),
    failed: v.number(),
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
    let pageCursor = state?.cursor ?? null
    let resumeAfter = state?.resumeAfter ?? null
    const page = await read(pageCursor).catch(() => {
      pageCursor = null
      resumeAfter = null
      return read(null)
    })
    const now = Date.now()
    /** `text`: unread, the searchable text, or why the article is skipped. */
    type Entry = {
      article: Doc<'articles'> | null
      text?: Shareable | 'too-large' | 'failed'
    }
    const articles = new Map<Id<'articles'>, Entry>()
    let seen = 0
    let rechecked = 0
    let cleared = 0
    let purged = 0
    let skipped = 0
    let failed = 0
    let lastFailedArticleId: Id<'articles'> | null = null
    let stopped = false
    let lastHandled: Id<'shares'> | null = null
    // Resume inside the page after the share the last step ended on; if that
    // row is gone, the page is walked again from its start (only re-checks).
    let skipping =
      resumeAfter !== null && page.page.some((r) => r._id === resumeAfter)

    for (const share of page.page) {
      if (skipping) {
        if (share._id === resumeAfter) skipping = false
        continue
      }
      if (share.quote === null && share.passageId === null) {
        const clearedAt = share.clearedAt ?? share.checkedAt
        seen++
        if (clearedAt + CLEARED_SHARE_RETENTION_MS < now) {
          // The code stays unusable: a link to it must never reach another line.
          await ctx.db.insert('retiredShareCodes', {
            code: share.code,
            retiredAt: now,
          })
          await ctx.db.delete(share._id)
          purged++
          // A deleted row cannot be where the next step resumes.
          continue
        }
        lastHandled = share._id
        continue
      }
      let entry = articles.get(share.articleId)
      if (!entry) {
        if (articles.size === SWEEP_ARTICLES_PER_STEP) {
          stopped = true
          break
        }
        entry = { article: await ctx.db.get(share.articleId) }
        articles.set(share.articleId, entry)
      }
      seen++
      lastHandled = share._id
      const article = entry.article
      if (isPublic(article)) {
        if (article.updatedAt <= share.checkedAt) continue
        if (entry.text === undefined) {
          try {
            entry.text = readShareable(article.content) ?? 'too-large'
          } catch (error) {
            console.error('share sweep: article check failed', {
              articleId: share.articleId,
              error: String(error),
            })
            entry.text = 'failed'
          }
        }
        if (entry.text === 'too-large') {
          skipped++
          await ctx.db.patch(share._id, { checkedAt: now })
          continue
        }
        let status: Located['status'] | 'failed' = 'failed'
        if (entry.text !== 'failed') {
          try {
            status = locate(share, article, entry.text).status
          } catch (error) {
            console.error('share sweep: share check failed', {
              shareId: share._id,
              error: String(error),
            })
          }
        }
        if (status === 'failed') {
          failed++
          lastFailedArticleId = share.articleId
          await ctx.db.patch(share._id, { checkedAt: now })
          continue
        }
        rechecked++
        if (status !== 'gone') {
          await ctx.db.patch(share._id, { checkedAt: now })
          continue
        }
      } else {
        rechecked++
      }
      if (await clearShare(ctx, share, now)) cleared++
    }

    const finished = !stopped && page.isDone
    const position = stopped
      ? { cursor: pageCursor, resumeAfter: lastHandled }
      : { cursor: page.isDone ? null : page.continueCursor, resumeAfter: null }
    const failures = (state?.failures ?? 0) + failed
    const record = {
      cursor: position.cursor,
      resumeAfter: position.resumeAfter ?? undefined,
      lastRunAt: now,
      ...(finished ? { lastPassAt: now } : {}),
      ...(failed > 0 ? { failures, lastFailureAt: now } : {}),
      ...(lastFailedArticleId ? { lastFailedArticleId } : {}),
    }
    if (state) {
      if (page.page.length > 0 || state.cursor !== position.cursor)
        await ctx.db.patch(state._id, record)
    } else if (page.page.length > 0) {
      await ctx.db.insert('shareSweeps', { key: 'shares', ...record })
    }
    // A step that stopped at the article budget does not use up a step of
    // the run: the run walks `SWEEP_STEPS_PER_RUN` full pages.
    const steps = args.steps ?? SWEEP_STEPS_PER_RUN
    if (!finished && (stopped || steps > 1)) {
      await ctx.scheduler.runAfter(0, internal.shares.sweep, {
        steps: stopped ? steps : steps - 1,
      })
    }
    return { seen, rechecked, cleared, purged, skipped, failed, done: finished }
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
