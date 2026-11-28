/**
 * The Write backend: the desk list, saving drafts and publishing.
 *
 * - `desk` lists the caller's drafts and published articles, bounded, with
 *   no article content in the answer.
 * - `saveDraft` saves a draft's title and document only. An update must carry
 *   `baseUpdatedAt`, and a newer save is never overwritten (`draft-changed`),
 *   so one device can never silently replace another's words; with `clientId` a repeated create
 *   returns the draft it already made. It never touches the excerpt, tags,
 *   cover image or writer notes.
 * - `publish` requires the `updatedAt` the writer last saw, so the text
 *   published is the text on their screen; it refuses a document that is too
 *   large, and makes a permanent copy only when `permanentCopy` is true. The
 *   readability refusal (`document-not-readable`) cannot fire yet:
 *   `READING_SANITIZER` (`convex/lib/write/document.ts`) is null until the
 *   article view's sanitiser is in this tree.
 *
 * Errors are `ConvexError({ code })`, with the codes named on each function.
 * `articles.saveDraft` and `articles.publishArticle` stay as they are for the
 * pages that still use them.
 */
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server'
import { publishContentAnchor } from './articles'
import {
  buildSearchContent,
  replaceTagLinksForArticle,
} from './lib/articleListing'
import {
  generateUniqueArticleSlugForAuthor,
  isPlaceholderArticleSlug,
} from './lib/articleSlug'
import {
  MIN_PUBLISHABLE_TITLE_LENGTH,
  isPublishBlockedArticleTitle,
} from './lib/articleTitle'
import { ARTICLE_SCHEMA } from './lib/chain/ids'
import { syncReadingRoomArticle } from './lib/readingRoomIndex'
import { scheduleShareReconcile } from './shares'
import { nextUpdatedAt } from './lib/write/clock'
import { syncDeskRow } from './lib/write/deskRow'
import { tiptapJsonHasNonEmptyText } from './lib/tiptapContent'
import { syncArticleUploadReferences } from './lib/uploadReferences'
import {
  checkReadingDocument,
  firstLineOf,
  documentShapeProblem,
  isDocumentTooLarge,
  sanitizerFindsTooLarge,
  wordsOf,
} from './lib/write/document'
import { permanentStorageEnabled } from './permanentStorage'
import { chainOrNull, registrationOf } from './publishing'
import { verifiedStellarAddress } from './lib/walletVerification'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { isArticleLocked } from '../lib/articles/publishedLock'

/**
 * Rows per desk list. A query may read at most 16 MiB (measured on a local
 * backend: 20 drafts of 790 KB read, 24 failed with "Too many bytes read"),
 * and every row read is a whole article document, up to the 1 MiB document
 * limit. So the two lists together read at most 2 × 7 documents, 14 MiB, plus
 * the user row, at the largest document size.
 */
export const DESK_DEFAULT_LIMIT = 7
export const DESK_MAX_LIMIT = 7
export const TITLE_MAX_LENGTH = 200
const CLIENT_ID_PATTERN = /^l-[0-9a-f-]{36}$/

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DESK_DEFAULT_LIMIT
  return Math.min(DESK_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

async function requireUser(ctx: MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new ConvexError({ code: 'not-signed-in' })
  return userId
}

/** The caller's own article, or `draft-not-found` (missing and not theirs alike). */
async function ownArticle(
  ctx: MutationCtx,
  userId: Id<'users'>,
  id: Id<'articles'>
): Promise<Doc<'articles'>> {
  const article = await ctx.db.get(id)
  if (!article || article.authorId !== userId) {
    throw new ConvexError({ code: 'draft-not-found' })
  }
  return article
}

/**
 * The caller's desk. Drafts: `{ _id, title, firstLine, words, updatedAt }`,
 * newest first. Published: `{ _id, title, slug, authorUsername, publishedAt }`,
 * most recently updated first. `limit` (1 to `DESK_MAX_LIMIT`, 7, which is
 * also the default) applies to each list; see `DESK_MAX_LIMIT` for the read
 * bound. Signed out: both lists empty.
 */
export const desk = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    drafts: v.array(
      v.object({
        _id: v.id('articles'),
        title: v.string(),
        firstLine: v.string(),
        words: v.number(),
        updatedAt: v.number(),
      })
    ),
    published: v.array(
      v.object({
        _id: v.id('articles'),
        title: v.string(),
        slug: v.string(),
        authorUsername: v.string(),
        publishedAt: v.union(v.number(), v.null()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return { drafts: [], published: [] }
    const limit = clampLimit(args.limit)
    const list = (published: boolean) =>
      ctx.db
        .query('articles')
        .withIndex('by_author_published_updated_at', (q) =>
          q.eq('authorId', userId).eq('published', published)
        )
        .order('desc')
        .take(limit)
    const [drafts, published, user] = await Promise.all([
      list(false),
      list(true),
      ctx.db.get(userId),
    ])
    return {
      drafts: drafts.map((a) => ({
        _id: a._id,
        title: a.title,
        firstLine: firstLineOf(a.content),
        words: wordsOf(a.content),
        updatedAt: a.updatedAt,
      })),
      published: published.map((a) => ({
        _id: a._id,
        title: a.title,
        slug: a.slug,
        authorUsername: user?.username ?? a.authorUsername,
        publishedAt: a.publishedAt ?? null,
      })),
    }
  },
})

/**
 * Saves a draft's title and document; returns `{ id, updatedAt, created }`:
 * `updatedAt` is the base for the next save, and `created` is true only when
 * this call made a new draft (false for an update, and for a create whose
 * `clientId` is already known, so the client learns that the server may hold
 * earlier words for that draft). Errors: `not-signed-in`, `draft-not-found` (missing or
 * another writer's), `draft-published`, `draft-changed` (with the server's
 * `updatedAt`), `base-required` (an `id` without `baseUpdatedAt`),
 * `document-invalid` (with `reason`: `not-a-doc`, `value`, `key`,
 * `array-too-long`), `document-too-nested` (with `maxValueDepth`; see
 * `documentShapeProblem`), `draft-published` also for a create whose
 * `clientId` made a draft that is published now,
 * `draft-too-large`, `title-too-long`, `invalid-client-id`.
 * A refused save writes nothing.
 */
export const saveDraft = mutation({
  args: {
    id: v.optional(v.id('articles')),
    baseUpdatedAt: v.optional(v.number()),
    clientId: v.optional(v.string()),
    title: v.string(),
    content: v.any(),
  },
  returns: v.object({
    id: v.id('articles'),
    updatedAt: v.number(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx)
    if (args.title.length > TITLE_MAX_LENGTH) {
      throw new ConvexError({ code: 'title-too-long', max: TITLE_MAX_LENGTH })
    }
    if (args.clientId !== undefined && !CLIENT_ID_PATTERN.test(args.clientId)) {
      throw new ConvexError({ code: 'invalid-client-id' })
    }
    const shape = documentShapeProblem(args.content)
    if (shape) throw new ConvexError(shape)
    if (
      isDocumentTooLarge(args.content) ||
      sanitizerFindsTooLarge(args.content)
    ) {
      throw new ConvexError({ code: 'draft-too-large' })
    }

    if (args.id) {
      // An update states the save it builds on; without one it is refused,
      // so a stale tab can never overwrite newer words.
      if (args.baseUpdatedAt === undefined) {
        throw new ConvexError({ code: 'base-required' })
      }
      const article = await ownArticle(ctx, userId, args.id)
      if (isArticleLocked(article)) {
        throw new ConvexError({ code: 'draft-published' })
      }
      if (args.baseUpdatedAt !== article.updatedAt) {
        throw new ConvexError({
          code: 'draft-changed',
          updatedAt: article.updatedAt,
        })
      }
      const updatedAt = nextUpdatedAt(article.updatedAt)
      const slug =
        args.title !== article.title
          ? await generateUniqueArticleSlugForAuthor(ctx, {
              title: args.title,
              authorId: userId,
              excludeArticleId: article._id,
            })
          : article.slug
      await ctx.db.patch(article._id, {
        title: args.title,
        content: args.content,
        readTime: estimateArticleReadingMinutes(args.content),
        searchContent: buildSearchContent(args.title, article.excerpt, {
          tags: article.tags,
          content: args.content,
        }),
        ...(slug !== article.slug ? { slug } : {}),
        updatedAt,
      })
      const after = await ctx.db.get(article._id)
      if (after)
        await syncArticleUploadReferences(ctx, article._id, article, after)
      await syncDeskRow(ctx, article._id)
      return { id: article._id, updatedAt, created: false }
    }

    if (args.clientId !== undefined) {
      const known = await ctx.db
        .query('draftClientIds')
        .withIndex('by_author_client', (q) =>
          q.eq('authorId', userId).eq('clientId', args.clientId!)
        )
        .unique()
      const existing = known ? await ctx.db.get(known.articleId) : null
      if (existing && existing.authorId === userId) {
        // The draft this device made was published since: refused as a save
        // of a published id is, and the record stays, so a late retry never
        // makes a second draft.
        if (isArticleLocked(existing)) {
          throw new ConvexError({ code: 'draft-published' })
        }
        return {
          id: existing._id,
          updatedAt: existing.updatedAt,
          created: false,
        }
      }
      if (known) await ctx.db.delete(known._id)
    }

    const user = await ctx.db.get(userId)
    if (!user) throw new ConvexError({ code: 'not-signed-in' })
    const now = Date.now()
    const slug = await generateUniqueArticleSlugForAuthor(ctx, {
      title: args.title,
      authorId: userId,
    })
    const id = await ctx.db.insert('articles', {
      slug,
      title: args.title,
      content: args.content,
      published: false,
      authorId: userId,
      authorUsername: user.username,
      authorName: user.name,
      authorAvatar: user.avatar,
      tags: [],
      searchContent: buildSearchContent(args.title, undefined, {
        content: args.content,
      }),
      viewCount: 0,
      highlightCount: 0,
      tipCount: 0,
      totalTipsUsd: 0,
      readTime: estimateArticleReadingMinutes(args.content),
      createdAt: now,
      updatedAt: now,
    })
    if (args.clientId !== undefined) {
      await ctx.db.insert('draftClientIds', {
        authorId: userId,
        clientId: args.clientId,
        articleId: id,
        createdAt: now,
      })
    }
    await syncArticleUploadReferences(ctx, id, null, { content: args.content })
    await syncDeskRow(ctx, id)
    return { id, updatedAt: now, created: true }
  },
})

/**
 * Publishes the caller's draft as last saved at `baseUpdatedAt`. A permanent
 * copy is made only when `permanentCopy` is true and this deployment stores
 * articles permanently. Errors: `not-signed-in`, `draft-not-found`,
 * `already-published`, `draft-changed` (with the server's `updatedAt`),
 * `document-too-large`, `document-not-readable` (not before the reading
 * sanitiser is wired), and the rules `articles.publishArticle` applies
 * except its receiving-wallet rule: `title-required` (with `minLength`:
 * empty, "Untitled" or shorter), `body-empty` (no text), `username-required`.
 * No receiving address, excerpt or other preview is required: an article
 * published without an address takes no tips until the writer confirms one
 * and turns tips on.
 */
export const publish = mutation({
  args: {
    id: v.id('articles'),
    baseUpdatedAt: v.number(),
    permanentCopy: v.optional(v.boolean()),
  },
  returns: v.object({
    id: v.id('articles'),
    slug: v.string(),
    contentHash: v.string(),
    contentVersion: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx)
    const article = await ownArticle(ctx, userId, args.id)
    if (article.published) throw new ConvexError({ code: 'already-published' })
    if (args.baseUpdatedAt !== article.updatedAt) {
      throw new ConvexError({
        code: 'draft-changed',
        updatedAt: article.updatedAt,
      })
    }
    const reading = checkReadingDocument(article.content)
    if (!reading.ok) throw new ConvexError({ code: reading.code })

    const user = await ctx.db.get(userId)
    if (!user) throw new ConvexError({ code: 'not-signed-in' })
    // The publish rules of `articles.publishArticle`, as typed refusals, but
    // one: publishing needs no receiving address. Tips are a second step
    // (`publishing.registrationState`, `chain/articles` registration), which
    // still requires the confirmed address; until then no tip path accepts
    // the article.
    if (isPublishBlockedArticleTitle(article.title)) {
      throw new ConvexError({
        code: 'title-required',
        minLength: MIN_PUBLISHABLE_TITLE_LENGTH,
      })
    }
    if (!article.content || !tiptapJsonHasNonEmptyText(article.content)) {
      throw new ConvexError({ code: 'body-empty' })
    }
    if (!article.authorUsername?.trim()) {
      throw new ConvexError({ code: 'username-required' })
    }

    const anchor = await publishContentAnchor(article)
    const updatedAt = nextUpdatedAt(article.updatedAt)
    let slug = article.slug
    if (isPlaceholderArticleSlug(article.slug)) {
      slug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: article.title,
        authorId: userId,
        excludeArticleId: article._id,
      })
    }
    const shouldUpload =
      args.permanentCopy === true &&
      permanentStorageEnabled() &&
      (!article.arweaveStatus || article.arweaveStatus === 'failed')

    await ctx.db.patch(article._id, {
      published: true,
      publishedAt: updatedAt,
      readTime: estimateArticleReadingMinutes(article.content),
      searchContent: buildSearchContent(article.title, article.excerpt, {
        tags: article.tags,
        content: article.content,
      }),
      ...(slug !== article.slug ? { slug } : {}),
      ...(shouldUpload ? { arweaveStatus: 'pending' } : {}),
      contentHash: anchor.contentHash,
      contentVersion: anchor.contentVersion,
      contentHashSchema: ARTICLE_SCHEMA,
      updatedAt,
    })
    const published = await ctx.db.get(article._id)
    if (published) {
      await replaceTagLinksForArticle(ctx, published)
      await syncReadingRoomArticle(ctx, published._id, published)
    }
    await syncDeskRow(ctx, article._id)
    // Shares made while the article was published before are checked against
    // the text now published (none exist for a first publish).
    await scheduleShareReconcile(ctx, article._id)
    if (shouldUpload) {
      await ctx.scheduler.runAfter(0, internal.arweave.uploadArticleToArweave, {
        articleId: article._id,
      })
    }
    await ctx.db.patch(userId, {
      articleCount: (user.articleCount || 0) + 1,
      updatedAt,
    })
    return {
      id: article._id,
      slug,
      contentHash: anchor.contentHash,
      contentVersion: anchor.contentVersion,
      updatedAt,
    }
  },
})

/** Desk rows one page returns at most; the desk asks for 20. */
export const DESK_PAGE_MAX = 50
/**
 * Published rows one page returns at most: each reads its tips state (up to
 * 20 registration rows and one submission), so a page stays small.
 */
export const DESK_PUBLISHED_PAGE_MAX = 20

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' }

/** Rows the "anything left?" peek reads at most. */
const PEEK_ROWS = 64

/**
 * Whether rows remain after a full page, so a list that ends exactly at a
 * page's end says `isDone` and the desk never offers "Show more" for an
 * empty page. A function may run only one paginated read, so this peeks
 * with a plain indexed read of at most `PEEK_ROWS` rows at or below the last
 * row's sort key, in the same order, for one that comes after it. If every
 * row read sorts before it (a long run of equal keys), rows may remain.
 */
async function rowsRemain(
  page: Doc<'deskRows'>[],
  numItems: number,
  isDone: boolean,
  key: 'updatedAt' | 'publishedAt',
  peek: (value: number | null, take: number) => Promise<Doc<'deskRows'>[]>
): Promise<boolean> {
  if (isDone || page.length < numItems) return !isDone
  const last = page[page.length - 1]!
  // Draft rows always hold `updatedAt` (`deskFieldsOf`).
  const rows = await peek(last[key] ?? null, PEEK_ROWS)
  const after = (row: Doc<'deskRows'>) =>
    row[key] !== last[key] || row._creationTime < last._creationTime
  return rows.some(after) || rows.length === PEEK_ROWS
}

function pageOpts(
  opts: { numItems: number; cursor: string | null },
  max: number
) {
  const n = Number.isFinite(opts.numItems) ? Math.floor(opts.numItems) : max
  return { ...opts, numItems: Math.min(max, Math.max(1, n)) }
}

const tipsValidator = v.union(
  v.object({ state: v.literal('unavailable') }),
  v.object({ state: v.literal('not_registered') }),
  v.object({ state: v.literal('pending') }),
  v.object({ state: v.literal('held_for_review') }),
  v.object({ state: v.literal('registered'), payoutOutdated: v.boolean() })
)

/**
 * The caller's drafts, the most recently updated first, a page at a time
 * (at most `DESK_PAGE_MAX` rows). Reads only desk rows, never an article
 * document, so every page stays small whatever the drafts weigh. Signed
 * out: an empty, finished page.
 */
export const deskDrafts = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      _id: v.id('articles'),
      title: v.string(),
      firstLine: v.string(),
      words: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return EMPTY_PAGE
    const opts = pageOpts(args.paginationOpts, DESK_PAGE_MAX)
    const result = await ctx.db
      .query('deskRows')
      .withIndex('by_author_published_updated', (q) =>
        q.eq('authorId', userId).eq('published', false)
      )
      .order('desc')
      .paginate(opts)
    const remain = await rowsRemain(
      result.page,
      opts.numItems,
      result.isDone,
      'updatedAt',
      (value, take) =>
        ctx.db
          .query('deskRows')
          .withIndex('by_author_published_updated', (q) =>
            q
              .eq('authorId', userId)
              .eq('published', false)
              .lte('updatedAt', value as number)
          )
          .order('desc')
          .take(take)
    )
    return {
      ...result,
      isDone: !remain,
      page: result.page.map((row) => ({
        _id: row.articleId,
        title: row.title,
        firstLine: row.firstLine,
        words: row.words,
        // Every draft row has one (`deskFieldsOf`).
        updatedAt: row.updatedAt ?? 0,
      })),
    }
  },
})

/**
 * The caller's published articles, the most recently published first, a
 * page at a time (at most `DESK_PUBLISHED_PAGE_MAX`), each with its tips
 * state by the rules of `publishing.registrationState`, without an address,
 * hash or next step. Reads desk rows, the caller's user row, and per row
 * its registration rows. Signed out: an empty, finished page.
 */
export const deskPublished = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      _id: v.id('articles'),
      title: v.string(),
      slug: v.string(),
      authorUsername: v.string(),
      publishedAt: v.union(v.number(), v.null()),
      tips: tipsValidator,
    })
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return EMPTY_PAGE
    const opts = pageOpts(args.paginationOpts, DESK_PUBLISHED_PAGE_MAX)
    const [result, user] = await Promise.all([
      ctx.db
        .query('deskRows')
        .withIndex('by_author_published_at', (q) =>
          q.eq('authorId', userId).eq('published', true)
        )
        .order('desc')
        .paginate(opts),
      ctx.db.get(userId),
    ])
    const remain = await rowsRemain(
      result.page,
      opts.numItems,
      result.isDone,
      'publishedAt',
      (value, take) =>
        ctx.db
          .query('deskRows')
          .withIndex('by_author_published_at', (q) =>
            q
              .eq('authorId', userId)
              .eq('published', true)
              .lte('publishedAt', value)
          )
          .order('desc')
          .take(take)
    )
    const chain = chainOrNull()
    const wallet = chain ? verifiedStellarAddress(user, chain.passphrase) : null
    const page = []
    for (const row of result.page) {
      const state = await registrationOf(
        ctx,
        { _id: row.articleId, published: true },
        chain,
        wallet
      )
      page.push({
        _id: row.articleId,
        title: row.title,
        slug: row.slug,
        authorUsername: user?.username ?? '',
        publishedAt: row.publishedAt,
        tips:
          state.state === 'registered'
            ? {
                state: 'registered' as const,
                payoutOutdated: state.payoutOutdated,
              }
            : { state: state.state },
      })
    }
    return { ...result, isDone: !remain, page }
  },
})

/** Articles one backfill step reads: each can be up to 1 MiB. */
export const DESK_BACKFILL_ARTICLES = 8
/** Desk rows one backfill step checks in its second phase. */
export const DESK_BACKFILL_ROWS = 100

/**
 * Writes the desk row of every article, then removes desk rows whose article
 * is gone; a page per step, rescheduling itself until done. Each row is
 * synced as a save would sync it, so a second run, or a run beside live
 * saves, changes nothing. A finished run does nothing until `restart`. A
 * step of a logged window on a deployment; not run by a cron.
 */
export const backfillDeskRows = internalMutation({
  args: { restart: v.optional(v.boolean()) },
  returns: v.object({
    phase: v.union(v.literal('articles'), v.literal('rows')),
    rows: v.number(),
    changed: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now()
    const find = () =>
      ctx.db
        .query('deskRowBackfills')
        .withIndex('by_key', (q) => q.eq('key', 'desk'))
        .unique()
    let state = await find()
    if (!state || args.restart) {
      const fresh = {
        key: 'desk' as const,
        phase: 'articles' as const,
        cursor: null,
        rows: 0,
        changed: 0,
        startedAt: now,
        updatedAt: now,
      }
      if (state) await ctx.db.replace(state._id, fresh)
      else await ctx.db.insert('deskRowBackfills', fresh)
      state = (await find())!
    }
    if (state.finishedAt !== undefined) {
      return {
        phase: state.phase,
        rows: state.rows,
        changed: state.changed,
        done: true,
      }
    }
    let ids: Id<'articles'>[]
    let isDone: boolean
    let continueCursor: string
    if (state.phase === 'articles') {
      const page = await ctx.db
        .query('articles')
        .paginate({ numItems: DESK_BACKFILL_ARTICLES, cursor: state.cursor })
      ids = page.page.map((a) => a._id)
      ;({ isDone, continueCursor } = page)
    } else {
      const page = await ctx.db
        .query('deskRows')
        .paginate({ numItems: DESK_BACKFILL_ROWS, cursor: state.cursor })
      ids = page.page.map((r) => r.articleId)
      ;({ isDone, continueCursor } = page)
    }
    let changed = 0
    for (const id of ids) if (await syncDeskRow(ctx, id)) changed++
    const next = !isDone
      ? { phase: state.phase, cursor: continueCursor }
      : state.phase === 'articles'
        ? { phase: 'rows' as const, cursor: null }
        : null
    await ctx.db.patch(state._id, {
      ...(next ?? { cursor: null, finishedAt: now }),
      rows: state.rows + ids.length,
      changed: state.changed + changed,
      updatedAt: now,
    })
    if (next)
      await ctx.scheduler.runAfter(0, internal.write.backfillDeskRows, {})
    return {
      phase: state.phase,
      rows: state.rows + ids.length,
      changed: state.changed + changed,
      done: next === null,
    }
  },
})
