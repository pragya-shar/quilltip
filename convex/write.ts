/**
 * The Write backend: the desk list, saving drafts and publishing.
 *
 * - `desk` lists the caller's drafts and published articles, bounded, with
 *   no article content in the answer.
 * - `saveDraft` saves a draft's title and document only. With `baseUpdatedAt`
 *   it refuses to overwrite a newer save (`draft-changed`), so one device can
 *   never silently replace another's words; with `clientId` a repeated create
 *   returns the draft it already made. It never touches the excerpt, tags,
 *   cover image or writer notes.
 * - `publish` requires the `updatedAt` the writer last saw, so the text
 *   published is the text on their screen; it refuses a document that is too
 *   large or would not read back unchanged, and makes a permanent copy only
 *   when `permanentCopy` is true.
 *
 * Errors are `ConvexError({ code })`, with the codes named on each function.
 * `articles.saveDraft` and `articles.publishArticle` stay as they are for the
 * pages that still use them.
 */
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx } from './_generated/server'
import { assertAuthorCanReceiveTips, publishContentAnchor } from './articles'
import { assertArticleListingReady } from './lib/articleListingReady'
import {
  buildSearchContent,
  replaceTagLinksForArticle,
} from './lib/articleListing'
import {
  generateUniqueArticleSlugForAuthor,
  isPlaceholderArticleSlug,
} from './lib/articleSlug'
import { assertPublishableArticleTitle } from './lib/articleTitle'
import { ARTICLE_SCHEMA } from './lib/chain/ids'
import { syncReadingRoomArticle } from './lib/readingRoomIndex'
import { tiptapJsonHasNonEmptyText } from './lib/tiptapContent'
import { syncArticleUploadReferences } from './lib/uploadReferences'
import {
  checkReadingDocument,
  firstLineOf,
  isDocumentTooLarge,
  sanitizerFindsTooLarge,
  wordsOf,
} from './lib/write/document'
import { permanentStorageEnabled } from './permanentStorage'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { isArticleLocked } from '../lib/articles/publishedLock'

export const DESK_DEFAULT_LIMIT = 20
export const DESK_MAX_LIMIT = 50
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

/** A time after `previous`, so every save gives the client a new base. */
function nextUpdatedAt(previous: number): number {
  const now = Date.now()
  return now > previous ? now : previous + 1
}

/**
 * The caller's desk. Drafts: `{ _id, title, firstLine, words, updatedAt }`,
 * newest first. Published: `{ _id, title, slug, authorUsername, publishedAt }`,
 * most recently updated first. `limit` (1 to 50, default 20) applies to each
 * list. Signed out: both lists empty.
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
 * Saves a draft's title and document; returns `{ id, updatedAt }`, the base
 * for the next save. Errors: `not-signed-in`, `draft-not-found` (missing or
 * another writer's), `draft-published`, `draft-changed` (with the server's
 * `updatedAt`), `draft-too-large`, `title-too-long`, `invalid-client-id`.
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
  returns: v.object({ id: v.id('articles'), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx)
    if (args.title.length > TITLE_MAX_LENGTH) {
      throw new ConvexError({ code: 'title-too-long', max: TITLE_MAX_LENGTH })
    }
    if (args.clientId !== undefined && !CLIENT_ID_PATTERN.test(args.clientId)) {
      throw new ConvexError({ code: 'invalid-client-id' })
    }
    if (
      isDocumentTooLarge(args.content) ||
      sanitizerFindsTooLarge(args.content)
    ) {
      throw new ConvexError({ code: 'draft-too-large' })
    }

    if (args.id) {
      const article = await ownArticle(ctx, userId, args.id)
      if (isArticleLocked(article)) {
        throw new ConvexError({ code: 'draft-published' })
      }
      if (
        args.baseUpdatedAt !== undefined &&
        args.baseUpdatedAt !== article.updatedAt
      ) {
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
      return { id: article._id, updatedAt }
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
        return { id: existing._id, updatedAt: existing.updatedAt }
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
    return { id, updatedAt: now }
  },
})

/**
 * Publishes the caller's draft as last saved at `baseUpdatedAt`. A permanent
 * copy is made only when `permanentCopy` is true and this deployment stores
 * articles permanently. Errors: `not-signed-in`, `draft-not-found`,
 * `already-published`, `draft-changed` (with the server's `updatedAt`),
 * `document-too-large`, `document-not-readable`; and the publish rules shared
 * with `articles.publishArticle` (title, body, preview, receiving wallet).
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
    assertAuthorCanReceiveTips(user)
    assertPublishableArticleTitle(article.title)
    if (!article.content || !tiptapJsonHasNonEmptyText(article.content)) {
      throw new Error('Cannot publish: article body is empty')
    }
    assertArticleListingReady({
      title: article.title,
      excerpt: article.excerpt,
      authorUsername: article.authorUsername,
    })

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
