import { getConvexSize, v } from 'convex/values'
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import schema from './schema'
import type { Doc, Id } from './_generated/dataModel'
import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import { getAuthUserId } from '@convex-dev/auth/server'
import {
  READING_ROOM_HYDRATION_SIZE,
  READING_ROOM_SCAN_SIZE,
} from '../lib/articles/readingRoomSearchBatch'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { enrichWithUser, type PublicUser } from './lib/enrich'
import {
  getReadingRoomIndexState,
  hasReadingRoomReadBudget,
  matchReadingRoomRows,
  probeReadingRoomIndex,
  readingRoomRankValidator,
  readingRoomTerms,
  syncReadingRoomArticle,
} from './lib/readingRoomIndex'
import { syncArticleUploadReferences } from './lib/uploadReferences'
import {
  generateUniqueArticleSlugForAuthor,
  isPlaceholderArticleSlug,
} from './lib/articleSlug'
import {
  buildSearchContent,
  removeTagLinksForArticle,
  replaceTagLinksForArticle,
} from './lib/articleListing'
import {
  assertPublishableArticleTitle,
  isPlaceholderArticleTitle,
} from './lib/articleTitle'
import {
  assertArticleListingReady,
  isArticleListingReady,
} from './lib/articleListingReady'
import {
  fetchArticlesByTagSearch,
  searchListingArticles,
} from './lib/articleSearch'
import {
  normalizeBrowsePage,
  paginateBrowseArticles,
  paginateReadingRoomMatches,
  type BrowseSort,
  type BrowseView,
} from './lib/articleBrowseSort'
import {
  extractTextFromTiptapJson,
  tiptapJsonHasNonEmptyText,
} from './lib/tiptapContent'

const WRITER_NOTES_MAX_LENGTH = 5000
const PUBLISH_RECEIVING_WALLET_ERROR =
  'Connect a receiving wallet before publishing so readers can tip this article'

function stripWriterNotes<T extends { writerNotes?: string }>(
  article: T
): Omit<T, 'writerNotes'> {
  const { writerNotes: _writerNotes, ...rest } = article
  return rest
}

// Validation helper for article input
function validateArticleInput(args: {
  title: string
  excerpt?: string
  tags?: string[]
  writerNotes?: string
}) {
  if (!args.title || args.title.trim().length === 0) {
    throw new Error('Title is required')
  }
  if (args.title.length > 200) {
    throw new Error('Title must be 200 characters or less')
  }
  if (args.excerpt && args.excerpt.length > 500) {
    throw new Error('Excerpt must be 500 characters or less')
  }
  if (args.tags) {
    if (args.tags.length > 10) {
      throw new Error('Maximum 10 tags allowed')
    }
    for (const tag of args.tags) {
      if (tag.length > 50) {
        throw new Error('Each tag must be 50 characters or less')
      }
    }
  }
  if (args.writerNotes && args.writerNotes.length > WRITER_NOTES_MAX_LENGTH) {
    throw new Error(
      `Writer notes must be ${WRITER_NOTES_MAX_LENGTH} characters or less`
    )
  }
}

function assertAuthorCanReceiveTips(user: { stellarAddress?: string | null }) {
  if (!user.stellarAddress) {
    throw new Error(PUBLISH_RECEIVING_WALLET_ERROR)
  }
}

const browseViewValidator = v.union(
  v.literal('latest'),
  v.literal('trending'),
  v.literal('featured')
)

const browseSortValidator = v.union(
  v.literal('newest'),
  v.literal('oldest'),
  v.literal('most_tipped'),
  v.literal('title')
)

const readingRoomFilters = {
  tag: v.optional(v.string()),
  author: v.optional(v.string()),
  category: v.optional(
    v.union(v.literal('stories'), v.literal('thoughts'), v.literal('anecdotes'))
  ),
  bookmarkIds: v.optional(v.array(v.string())),
}

async function findBrowseAuthor(ctx: QueryCtx, username: string) {
  return ctx.db
    .query('users')
    .withIndex('by_username', (q) => q.eq('username', username))
    .first()
}

async function loadReadingRoomArticle(
  ctx: QueryCtx,
  id: Id<'articles'>,
  authors: Map<Id<'users'>, PublicUser | null>
) {
  const article = await ctx.db.get(id)
  if (!article?.published || !isArticleListingReady(article)) return null
  if (!authors.has(article.authorId)) {
    authors.set(article.authorId, await enrichWithUser(ctx, article.authorId))
  }
  return {
    ...stripWriterNotes(article),
    readTime: estimateArticleReadingMinutes(article.content),
    author: authors.get(article.authorId) ?? null,
  }
}

// The narrow lookup remains reactive and returns cards in a single round trip.
// List articles with pagination and filters
export const listArticles = query({
  args: {
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
    ...readingRoomFilters,
    search: v.optional(v.string()),
    view: v.optional(browseViewValidator),
    sort: v.optional(browseSortValidator),
    searchByWriterOrTitle: v.optional(v.boolean()),
    allowSearchScan: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { page, limit } = normalizeBrowsePage(args)
    const offset = (page - 1) * limit
    const view: BrowseView = args.view ?? 'latest'
    const sort: BrowseSort = args.sort ?? 'newest'

    const tag = args.tag?.trim() || undefined
    const searchRaw = args.search?.trim()
    const search =
      searchRaw && searchRaw.length > 0 ? searchRaw.slice(0, 200) : undefined

    let authorId: Id<'users'> | undefined
    if (args.author) {
      const author = await findBrowseAuthor(ctx, args.author)

      if (!author) {
        return {
          articles: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        }
      }
      authorId = author._id
    }

    // Empty bookmarks also provide a cheap capability check on mixed deployments.
    if (args.bookmarkIds?.length === 0 && !args.allowSearchScan && !search) {
      return {
        articles: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        browseMeta: paginateBrowseArticles([], view, sort, offset, limit)
          .browseMeta,
        supportsSearchScan: true as const,
      }
    }

    const writerTitleSearch =
      search && args.searchByWriterOrTitle ? search : undefined
    const indexed =
      writerTitleSearch && (await getReadingRoomIndexState(ctx))?.complete
    const bounded = args.allowSearchScan === true
    if (writerTitleSearch && (indexed || bounded)) {
      const scan = {
        articles: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        scanRequired: true as const,
        browseMeta: undefined,
      }
      if (!indexed) return scan

      const terms = readingRoomTerms(writerTitleSearch)
      const filters = {
        authorId,
        tag,
        category: args.category,
        bookmarkIds: args.bookmarkIds,
      }
      const probe = await probeReadingRoomIndex(ctx, terms, filters, bounded)
      if (!probe) return scan
      const matches = await matchReadingRoomRows(
        ctx,
        probe.rows,
        terms,
        filters,
        probe.authors,
        bounded
      )
      if (!matches) return scan

      const { slice, total, totalPages, browseMeta } =
        paginateReadingRoomMatches(matches.rows, {
          ...args,
          page,
          limit,
          view,
          sort,
        })
      const articles = []
      let responseBytes = 0
      for (const row of slice) {
        if (bounded && !(await hasReadingRoomReadBudget(ctx))) return scan
        const article = await loadReadingRoomArticle(
          ctx,
          row.articleId,
          matches.authors
        )
        if (!article) continue
        if (bounded) {
          responseBytes += getConvexSize({
            ...article,
            author: article.author && { ...article.author },
          })
          // A prolific writer's profile can be repeated in every card.
          if (responseBytes > 12 * 1024 * 1024) return scan
        }
        articles.push(article)
      }
      return { articles, total, page, limit, totalPages, browseMeta }
    }

    let rows: Doc<'articles'>[]
    if (args.bookmarkIds) {
      const ids = [...new Set(args.bookmarkIds)]
        .map((id) => ctx.db.normalizeId('articles', id))
        .filter((id) => id !== null)
      const saved = await Promise.all(ids.map((id) => ctx.db.get(id)))
      rows = saved.filter(
        (article): article is Doc<'articles'> =>
          article?.published === true &&
          (!authorId || article.authorId === authorId) &&
          (!tag || article.tags?.includes(tag) === true)
      )
    } else if (search && !writerTitleSearch) {
      rows = await searchListingArticles(ctx, {
        search,
        authorUsername: args.author,
        authorId,
        filterTag: tag,
      })
    } else if (tag) {
      rows = await fetchArticlesByTagSearch(ctx, tag, authorId)
    } else {
      rows = authorId
        ? await ctx.db
            .query('articles')
            .withIndex('by_author_published', (q) =>
              q.eq('authorId', authorId).eq('published', true)
            )
            .order('desc')
            .collect()
        : await ctx.db
            .query('articles')
            .withIndex('by_published_date', (q) => q.eq('published', true))
            .order('desc')
            .collect()
    }
    rows = rows.filter(isArticleListingReady)
    if (args.category) {
      rows = rows.filter((article) =>
        article.tags?.some((tag) => tag.trim().toLowerCase() === args.category)
      )
    }

    const writers = new Map<
      Id<'users'>,
      Awaited<ReturnType<typeof enrichWithUser>>
    >()
    if (writerTitleSearch) {
      await Promise.all(
        [...new Set(rows.map((article) => article.authorId))].map(
          async (id) => {
            writers.set(id, await enrichWithUser(ctx, id))
          }
        )
      )
      const terms = readingRoomTerms(writerTitleSearch)
      rows = rows.filter((article) => {
        const writer = writers.get(article.authorId)
        const text = [
          article.title,
          writer?.name ?? article.authorName,
          writer?.username ?? article.authorUsername,
        ]
          .join(' ')
          .toLowerCase()
        return terms.every((term) => text.includes(term))
      })
    }
    const { slice, total, totalPages, browseMeta } = paginateBrowseArticles(
      rows,
      view,
      sort,
      offset,
      limit
    )
    const enrichedArticles = await Promise.all(
      slice.map(async (article) => ({
        ...stripWriterNotes(article),
        readTime: estimateArticleReadingMinutes(article.content),
        author: writers.has(article.authorId)
          ? (writers.get(article.authorId) ?? null)
          : await enrichWithUser(ctx, article.authorId),
      }))
    )
    return {
      articles: enrichedArticles,
      total,
      page,
      limit,
      totalPages,
      browseMeta,
    }
  },
})

// Each call scans one bounded cursor range. Return only the public fields
// needed to count and rank matches across ranges.
export const scanReadingRoomSearch = query({
  args: {
    ...readingRoomFilters,
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(readingRoomRankValidator),
  handler: async (ctx, args) => {
    const author = args.author ? await findBrowseAuthor(ctx, args.author) : null
    if (args.author && !author)
      return { page: [], isDone: true, continueCursor: '' }
    const authorId = author?._id
    const options = {
      ...args.paginationOpts,
      numItems: Math.min(
        READING_ROOM_SCAN_SIZE,
        Math.max(1, args.paginationOpts.numItems)
      ),
      maximumRowsRead: READING_ROOM_SCAN_SIZE * 2,
      maximumBytesRead: 4 * 1024 * 1024,
    }
    const indexed = (await getReadingRoomIndexState(ctx))?.complete
    const batch = indexed
      ? await (
          authorId
            ? ctx.db
                .query('readingRoomArticles')
                .withIndex('by_author', (q) => q.eq('authorId', authorId))
            : ctx.db.query('readingRoomArticles')
        ).paginate(options)
      : await (
          authorId
            ? ctx.db
                .query('articles')
                .withIndex('by_author_published', (q) =>
                  q.eq('authorId', authorId).eq('published', true)
                )
            : ctx.db
                .query('articles')
                .withIndex('by_published', (q) => q.eq('published', true))
        ).paginate(options)

    if (batch.pageStatus === 'SplitRequired') return { ...batch, page: [] }
    const candidates = batch.page.flatMap<
      Parameters<typeof matchReadingRoomRows>[1][number]
    >((row) =>
      'articleId' in row
        ? [row]
        : isArticleListingReady(row)
          ? [{ ...row, articleId: row._id, createdAt: row._creationTime }]
          : []
    )
    // The writer picker counts every public article using the same bounded
    // cursor source. It resolves only the final top writers' profiles.
    if (args.search === undefined) {
      return {
        ...batch,
        page: candidates.map((row) => ({
          articleId: row.articleId,
          createdAt: row.createdAt,
          publishedAt: row.publishedAt,
          writerId: row.authorId,
        })),
      }
    }
    const matches = await matchReadingRoomRows(
      ctx,
      candidates,
      readingRoomTerms(args.search),
      {
        authorId,
        tag: args.tag?.trim() || undefined,
        category: args.category,
        bookmarkIds: args.bookmarkIds,
      }
    )
    if (matches) return { ...batch, page: matches.rows }

    // Writer and tag lookups also consume the transaction's read budget.
    if (batch.splitCursor)
      return { ...batch, page: [], pageStatus: 'SplitRequired' as const }
    throw new Error('Reading Room scan exceeded its read budget')
  },
})

export const loadReadingRoomSearchPage = query({
  args: { ids: v.array(v.id('articles')) },
  returns: v.array(
    schema.tables.articles.validator.omit('writerNotes').extend({
      _id: v.id('articles'),
      _creationTime: v.number(),
      readTime: v.number(),
      author: v.union(
        v.object({
          id: v.id('users'),
          username: v.string(),
          name: v.optional(v.string()),
          avatar: v.optional(v.string()),
        }),
        v.null()
      ),
    })
  ),
  handler: async (ctx, { ids }) => {
    if (ids.length > READING_ROOM_HYDRATION_SIZE)
      throw new Error('Too many article IDs')
    const authors = new Map<Id<'users'>, PublicUser | null>()
    const articles = []
    for (const id of ids) {
      const article = await loadReadingRoomArticle(ctx, id, authors)
      if (article) articles.push(article)
    }
    return articles
  },
})

export const loadReadingRoomWriterOptions = query({
  args: { ids: v.array(v.id('articles')) },
  returns: v.array(
    v.object({ username: v.string(), name: v.union(v.string(), v.null()) })
  ),
  handler: async (ctx, { ids }) => {
    if (ids.length > READING_ROOM_HYDRATION_SIZE)
      throw new Error('Too many article IDs')
    const writers = []
    for (const id of ids) {
      const article = await ctx.db.get(id)
      if (!article?.published || !isArticleListingReady(article)) continue
      const user = await ctx.db.get(article.authorId)
      const username = user?.username.trim()
      if (user && username) writers.push({ username, name: user.name ?? null })
    }
    return writers
  },
})

// Small public reader projection. Keep selection bounded and check that each
// destination is readable before counting it toward the two end-matter rows.
export const getReadNextArticles = query({
  args: { articleId: v.id('articles') },
  returns: v.array(
    v.object({
      id: v.id('articles'),
      title: v.string(),
      slug: v.string(),
      username: v.string(),
      opening: v.string(),
    })
  ),
  handler: async (ctx, { articleId }) => {
    const next = []
    let scanned = 0
    const candidates = ctx.db
      .query('articles')
      .withIndex('by_published_date', (q) => q.eq('published', true))
      .order('desc')
    for await (const article of candidates) {
      if (++scanned > 50) break
      if (article._id === articleId || !isArticleListingReady(article)) continue
      const author = await ctx.db.get(article.authorId)
      if (!author?.username.trim() || !article.slug.trim()) continue
      const text = extractTextFromTiptapJson(article.content)
        .replace(/\s+/g, ' ')
        .trim()
      const opening = (
        text.match(/^[^.!?]+[.!?]/)?.[0] ||
        article.excerpt?.trim() ||
        text
      ).slice(0, 180)
      next.push({
        id: article._id,
        title: article.title,
        slug: article.slug,
        username: author.username,
        opening,
      })
      if (next.length === 2) break
    }
    return next
  },
})

export const listBrowseTags = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 30)
    const links = await ctx.db.query('articleTagLinks').collect()
    const counts = new Map<string, number>()
    for (const link of links) {
      counts.set(link.tag, (counts.get(link.tag) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([tag, articleCount]) => ({ tag, articleCount }))
  },
})

export const listBrowseAuthors = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)
    const rows = await ctx.db
      .query('articles')
      .withIndex('by_published_date', (q) => q.eq('published', true))
      .order('desc')
      .collect()

    const counts = new Map<Id<'users'>, number>()
    for (const article of rows) {
      if (!isArticleListingReady(article)) continue
      counts.set(article.authorId, (counts.get(article.authorId) ?? 0) + 1)
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    const authors: {
      username: string
      name: string | null
      articleCount: number
    }[] = []

    for (const [authorId, articleCount] of sorted) {
      const user = await ctx.db.get(authorId)
      const username = user?.username?.trim()
      if (!user || !username) continue
      authors.push({
        username,
        name: user.name ?? null,
        articleCount,
      })
    }

    return authors
  },
})

// Resolve browser-local IDs through the current public reader route.
export const getContinueReadingArticle = query({
  args: { ids: v.array(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('articles'),
      title: v.string(),
      slug: v.string(),
      username: v.string(),
    })
  ),
  handler: async (ctx, { ids }) => {
    for (const value of ids.slice(0, 20)) {
      const id = ctx.db.normalizeId('articles', value)
      if (!id) continue
      const article = await ctx.db.get(id)
      if (!article?.published) continue
      const author = await ctx.db.get(article.authorId)
      if (author?.username) {
        return {
          id,
          title: article.title,
          slug: article.slug,
          username: author.username,
        }
      }
    }
    return null
  },
})

// Get article by slug
export const getArticleBySlug = query({
  args: {
    username: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    // Find author
    const author = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', args.username))
      .first()

    if (!author) return null

    // Find article
    const article = await ctx.db
      .query('articles')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .filter((q) =>
        q.and(
          q.eq(q.field('authorId'), author._id),
          q.eq(q.field('published'), true)
        )
      )
      .first()

    if (!article) return null

    // Note: View count increment would need to be in a mutation
    // For now, we'll skip it in this query

    // Get tips count
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', article._id))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const tipStats = {
      count: tips.length,
      total: tips.reduce((sum, tip) => sum + tip.amountUsd, 0),
    }

    return {
      ...stripWriterNotes(article),
      author: {
        id: author._id,
        name: author.name,
        username: author.username,
        avatar: author.avatar,
        stellarAddress: author.stellarAddress,
      },
      tipStats,
    }
  },
})

// Get article by ID
export const getArticleById = query({
  args: { id: v.id('articles') },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.id)
    if (!article) return null

    const userId = await getAuthUserId(ctx)
    const isAuthor = userId === article.authorId

    // If unpublished, only the author can view it
    if (!article.published && !isAuthor) return null

    const author = await ctx.db.get(article.authorId)
    return {
      ...stripWriterNotes(article),
      ...(isAuthor ? { writerNotes: article.writerNotes } : {}),
      author: author
        ? {
            id: author._id,
            name: author.name,
            username: author.username,
            avatar: author.avatar,
            stellarAddress: author.stellarAddress,
          }
        : null,
    }
  },
})

// Get user drafts
export const getUserDrafts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const drafts = await ctx.db
      .query('articles')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter((q) => q.eq(q.field('published'), false))
      .order('desc')
      .collect()

    return drafts
  },
})

export const getCreatorRecentWork = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const limit = Math.min(Math.max(args.limit ?? 8, 1), 20)
    const articles = await ctx.db
      .query('articles')
      .withIndex('by_author_updated_at', (q) => q.eq('authorId', userId))
      .order('desc')
      .take(limit)

    return articles.map((article) => ({
      _id: article._id,
      title: article.title,
      excerpt: article.excerpt,
      published: article.published,
      updatedAt: article.updatedAt,
      slug: article.slug,
      authorUsername: article.authorUsername,
    }))
  },
})

export const getCreatorWorkspaceSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) {
      return {
        hasDrafts: false,
        mostRecentDraft: null,
      }
    }

    const mostRecentDraft = await ctx.db
      .query('articles')
      .withIndex('by_author_published_updated_at', (q) =>
        q.eq('authorId', userId).eq('published', false)
      )
      .order('desc')
      .first()

    return {
      hasDrafts: Boolean(mostRecentDraft),
      mostRecentDraft: mostRecentDraft
        ? {
            _id: mostRecentDraft._id,
            _creationTime: mostRecentDraft._creationTime,
            title: mostRecentDraft.title,
            updatedAt: mostRecentDraft.updatedAt,
          }
        : null,
    }
  },
})

// Create article
export const createArticle = mutation({
  args: {
    title: v.string(),
    content: v.any(),
    excerpt: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    published: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Validate input
    validateArticleInput(args)

    if (args.published) {
      assertPublishableArticleTitle(args.title)
      if (!tiptapJsonHasNonEmptyText(args.content)) {
        throw new Error('Cannot publish: article body is empty')
      }
    }

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    if (args.published) {
      assertAuthorCanReceiveTips(user)
      assertArticleListingReady({
        title: args.title,
        excerpt: args.excerpt,
        authorUsername: user.username,
      })
    }

    const finalSlug = await generateUniqueArticleSlugForAuthor(ctx, {
      title: args.title,
      authorId: userId,
    })

    const now = Date.now()

    const articleId = await ctx.db.insert('articles', {
      slug: finalSlug,
      title: args.title,
      content: args.content,
      excerpt: args.excerpt,
      coverImage: args.coverImage,
      published: args.published || false,
      publishedAt: args.published ? now : undefined,
      authorId: userId,
      authorUsername: user.username,
      authorName: user.name,
      authorAvatar: user.avatar,
      tags: args.tags || [],
      searchContent: buildSearchContent(args.title, args.excerpt, {
        tags: args.tags,
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

    await syncArticleUploadReferences(ctx, articleId, null, args)

    if (args.published) {
      const row = await ctx.db.get(articleId)
      if (row) {
        await replaceTagLinksForArticle(ctx, row)
        await syncReadingRoomArticle(ctx, row._id, row)
      }
    }

    return articleId
  },
})

// Update article
export const updateArticle = mutation({
  args: {
    id: v.id('articles'),
    title: v.optional(v.string()),
    content: v.optional(v.any()),
    excerpt: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const article = await ctx.db.get(args.id)
    if (!article) throw new Error('Article not found')
    if (article.authorId !== userId) throw new Error('Not authorized')

    // Validate input
    validateArticleInput({
      title: args.title ?? article.title,
      excerpt: args.excerpt,
      tags: args.tags,
    })

    const updates: {
      updatedAt: number
      title?: string
      slug?: string
      content?: unknown
      readTime?: number
      excerpt?: string
      coverImage?: string
      tags?: string[]
      searchContent?: string
    } = {
      updatedAt: Date.now(),
    }

    if (args.title !== undefined && args.title !== article.title) {
      updates.title = args.title
      if (!article.published) {
        const newSlug = await generateUniqueArticleSlugForAuthor(ctx, {
          title: args.title,
          authorId: userId,
          excludeArticleId: args.id,
        })
        if (newSlug !== article.slug) {
          updates.slug = newSlug
        }
      }
    }

    if (args.content !== undefined) {
      updates.content = args.content
      updates.readTime = estimateArticleReadingMinutes(args.content)
    }

    if (args.excerpt !== undefined) updates.excerpt = args.excerpt
    if (args.coverImage !== undefined) updates.coverImage = args.coverImage
    if (args.tags !== undefined) updates.tags = args.tags

    if (
      args.title !== undefined ||
      args.excerpt !== undefined ||
      args.content !== undefined ||
      args.tags !== undefined
    ) {
      updates.searchContent = buildSearchContent(
        args.title ?? article.title,
        args.excerpt !== undefined ? args.excerpt : article.excerpt,
        {
          tags: args.tags !== undefined ? args.tags : article.tags,
          content: args.content !== undefined ? args.content : article.content,
        }
      )
    }

    if (article.published) {
      const merged = {
        title: updates.title ?? article.title,
        excerpt:
          updates.excerpt !== undefined ? updates.excerpt : article.excerpt,
        authorUsername: article.authorUsername,
        content: updates.content ?? article.content,
      }
      if (!isArticleListingReady(merged)) {
        throw new Error(
          'Cannot update: published articles must keep a real title and readable preview for public discovery'
        )
      }
    }

    await ctx.db.patch(args.id, updates)

    const updated = await ctx.db.get(args.id)
    if (updated)
      await syncArticleUploadReferences(ctx, args.id, article, updated)
    if (updated?.published) {
      await replaceTagLinksForArticle(ctx, updated)
      await syncReadingRoomArticle(ctx, updated._id, updated)
    }

    return args.id
  },
})

// Publish article
export const publishArticle = mutation({
  args: {
    id: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const article = await ctx.db.get(args.id)
    if (!article) throw new Error('Article not found')
    if (article.authorId !== userId) throw new Error('Not authorized')
    if (article.published) throw new Error('Already published')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')
    assertAuthorCanReceiveTips(user)

    // Validate article has required content before publishing
    assertPublishableArticleTitle(article.title)
    if (!article.content) {
      throw new Error('Cannot publish: content is required')
    }
    if (!tiptapJsonHasNonEmptyText(article.content)) {
      throw new Error('Cannot publish: article body is empty')
    }

    assertArticleListingReady({
      title: article.title,
      excerpt: article.excerpt,
      authorUsername: article.authorUsername,
    })

    const now = Date.now()

    let slug = article.slug
    if (isPlaceholderArticleSlug(article.slug)) {
      const newSlug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: article.title,
        authorId: userId,
        excludeArticleId: args.id,
      })
      if (newSlug !== article.slug) {
        slug = newSlug
      }
    }

    // Only schedule Arweave upload if one isn't already pending or completed
    const shouldUpload =
      !article.arweaveStatus || article.arweaveStatus === 'failed'

    await ctx.db.patch(args.id, {
      published: true,
      publishedAt: now,
      readTime: estimateArticleReadingMinutes(article.content),
      searchContent: buildSearchContent(article.title, article.excerpt, {
        tags: article.tags,
        content: article.content,
      }),
      ...(slug !== article.slug ? { slug } : {}),
      ...(shouldUpload ? { arweaveStatus: 'pending' } : {}),
      updatedAt: now,
    })

    const publishedRow = await ctx.db.get(args.id)
    if (publishedRow) {
      await replaceTagLinksForArticle(ctx, publishedRow)
      await syncReadingRoomArticle(ctx, publishedRow._id, publishedRow)
    }

    if (shouldUpload) {
      // Schedule Arweave upload (runs in background)
      await ctx.scheduler.runAfter(0, internal.arweave.uploadArticleToArweave, {
        articleId: args.id,
      })
    }

    // Update user's article count
    await ctx.db.patch(userId, {
      articleCount: (user.articleCount || 0) + 1,
      updatedAt: now,
    })

    return { id: args.id, slug }
  },
})
// Delete article
export const deleteArticle = mutation({
  args: {
    id: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const article = await ctx.db.get(args.id)
    if (!article) throw new Error('Article not found')
    if (article.authorId !== userId) throw new Error('Not authorized')

    // Check for tipped highlights before deleting
    const highlights = await ctx.db
      .query('highlights')
      .withIndex('by_article', (q) => q.eq('articleId', args.id))
      .collect()

    for (const highlight of highlights) {
      const tip = await ctx.db
        .query('highlightTips')
        .withIndex('by_highlight', (q) =>
          q.eq('highlightId', highlight.highlightId)
        )
        .first()
      if (tip) {
        throw new Error(
          'Cannot delete: article has tipped highlights with financial records'
        )
      }
    }

    for (const highlight of highlights) {
      await ctx.db.delete(highlight._id)
    }

    await removeTagLinksForArticle(ctx, args.id)
    await syncReadingRoomArticle(ctx, args.id, null)

    await syncArticleUploadReferences(ctx, args.id, article, null)

    // Delete article
    await ctx.db.delete(args.id)

    // Update user's article count if it was published
    if (article.published) {
      const user = await ctx.db.get(userId)
      if (user) {
        await ctx.db.patch(userId, {
          articleCount: Math.max(0, (user.articleCount || 0) - 1),
          updatedAt: Date.now(),
        })
      }
    }

    return { success: true }
  },
})

// Save draft (auto-save)
export const saveDraft = mutation({
  args: {
    id: v.optional(v.id('articles')),
    title: v.string(),
    content: v.any(),
    excerpt: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    writerNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Validate input
    validateArticleInput(args)

    if (args.id) {
      // Update existing draft
      const article = await ctx.db.get(args.id)
      if (!article) throw new Error('Draft not found')
      if (article.authorId !== userId) throw new Error('Not authorized')

      const patch: {
        title: string
        content: unknown
        readTime: number
        excerpt?: string
        coverImage?: string
        tags?: string[]
        writerNotes?: string
        updatedAt: number
        slug?: string
        searchContent: string
      } = {
        title: args.title,
        content: args.content,
        readTime: estimateArticleReadingMinutes(args.content),
        excerpt: args.excerpt,
        coverImage: args.coverImage,
        tags: args.tags,
        writerNotes: args.writerNotes,
        updatedAt: Date.now(),
        searchContent: buildSearchContent(args.title, args.excerpt, {
          tags: args.tags,
          content: args.content,
        }),
      }

      if (!article.published && args.title !== article.title) {
        const newSlug = await generateUniqueArticleSlugForAuthor(ctx, {
          title: args.title,
          authorId: userId,
          excludeArticleId: args.id,
        })
        if (newSlug !== article.slug) {
          patch.slug = newSlug
        }
      }

      await ctx.db.patch(args.id, patch)

      const after = await ctx.db.get(args.id)
      if (after) await syncArticleUploadReferences(ctx, args.id, article, after)
      if (after?.published) {
        await replaceTagLinksForArticle(ctx, after)
        await syncReadingRoomArticle(ctx, after._id, after)
      }

      return args.id
    } else {
      // Create new draft
      // Create new draft
      const user = await ctx.db.get(userId)
      if (!user) throw new Error('User not found')

      const finalSlug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: args.title,
        authorId: userId,
      })

      const now = Date.now()

      const articleId = await ctx.db.insert('articles', {
        slug: finalSlug,
        title: args.title,
        content: args.content,
        excerpt: args.excerpt,
        coverImage: args.coverImage,
        writerNotes: args.writerNotes,
        published: false,
        authorId: userId,
        authorUsername: user.username,
        authorName: user.name,
        authorAvatar: user.avatar,
        tags: args.tags || [],
        searchContent: buildSearchContent(args.title, args.excerpt, {
          tags: args.tags,
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
      await syncArticleUploadReferences(ctx, articleId, null, args)
      return articleId
    }
  },
})

// One-off after deploy: bunx convex run articles:backfillArticleTagsAndSearchContent
export const backfillArticleTagsAndSearchContent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query('articles').collect()
    let updated = 0
    for (const article of articles) {
      const searchContent = buildSearchContent(article.title, article.excerpt, {
        tags: article.tags,
        content: article.content,
      })
      await ctx.db.patch(article._id, { searchContent })
      const fresh = await ctx.db.get(article._id)
      if (fresh?.published) await replaceTagLinksForArticle(ctx, fresh)
      updated += 1
    }
    return { updated }
  },
})

// One-off after deploy: bunx convex run internal/articles:unpublishArticlesWithPlaceholderTitles
export const unpublishArticlesWithPlaceholderTitles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query('articles').collect()
    const now = Date.now()
    let updated = 0
    const articleCountDeltaByAuthor = new Map<Id<'users'>, number>()

    for (const article of articles) {
      if (!article.published || !isPlaceholderArticleTitle(article.title)) {
        continue
      }

      await removeTagLinksForArticle(ctx, article._id)
      await syncReadingRoomArticle(ctx, article._id, null)
      await ctx.db.patch(article._id, {
        published: false,
        publishedAt: undefined,
        updatedAt: now,
      })

      articleCountDeltaByAuthor.set(
        article.authorId,
        (articleCountDeltaByAuthor.get(article.authorId) ?? 0) + 1
      )
      updated += 1
    }

    for (const [authorId, delta] of articleCountDeltaByAuthor) {
      const user = await ctx.db.get(authorId)
      if (user) {
        await ctx.db.patch(authorId, {
          articleCount: Math.max(0, (user.articleCount || 0) - delta),
          updatedAt: now,
        })
      }
    }

    return { updated }
  },
})

// Repair derived discovery data without rewriting the article or uploading it.
export const refreshArticleDiscovery = internalMutation({
  args: { ids: v.array(v.id('articles')) },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    if (
      args.ids.length === 0 ||
      args.ids.length > 50 ||
      new Set(args.ids).size !== args.ids.length
    ) {
      throw new Error('Choose 1 to 50 unique articles')
    }
    const articles = await Promise.all(args.ids.map((id) => ctx.db.get(id)))
    for (const article of articles) {
      if (!article?.published || !isArticleListingReady(article)) {
        throw new Error('Only public, readable articles can be indexed')
      }
    }
    for (const article of articles) {
      if (!article) continue
      await ctx.db.patch(article._id, {
        searchContent: buildSearchContent(article.title, article.excerpt, {
          tags: article.tags,
          content: article.content,
        }),
      })
      await replaceTagLinksForArticle(ctx, article)
      await syncReadingRoomArticle(ctx, article._id, article)
    }
    return { updated: articles.length }
  },
})

// Admin-only, reviewed-record cleanup. Preview is the default; no uploads or deletes.
export const hideReviewedArticles = internalMutation({
  args: {
    articles: v.array(
      v.object({
        id: v.id('articles'),
        expectedTitle: v.string(),
        expectedUpdatedAt: v.number(),
      })
    ),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    applied: v.boolean(),
    articles: v.array(v.object({ id: v.id('articles'), title: v.string() })),
  }),
  handler: async (ctx, args) => {
    if (args.articles.length === 0 || args.articles.length > 50) {
      throw new Error('Review between 1 and 50 articles at a time')
    }
    if (new Set(args.articles.map((a) => a.id)).size !== args.articles.length) {
      throw new Error('Duplicate article in cleanup')
    }
    const reviewed = await Promise.all(
      args.articles.map(async (expected) => {
        const article = await ctx.db.get(expected.id)
        if (
          !article ||
          !article.published ||
          article.title !== expected.expectedTitle ||
          article.updatedAt !== expected.expectedUpdatedAt
        ) {
          throw new Error(`Article ${expected.id} changed since review`)
        }
        return article
      })
    )
    const preview = reviewed.map((article) => ({
      id: article._id,
      title: article.title,
    }))
    if (args.dryRun !== false) return { applied: false, articles: preview }

    const now = Date.now()
    const deltas = new Map<Id<'users'>, number>()
    for (const article of reviewed) {
      await removeTagLinksForArticle(ctx, article._id)
      await syncReadingRoomArticle(ctx, article._id, null)
      await ctx.db.patch(article._id, { published: false, updatedAt: now })
      deltas.set(article.authorId, (deltas.get(article.authorId) ?? 0) + 1)
    }
    for (const [authorId, delta] of deltas) {
      const author = await ctx.db.get(authorId)
      if (author)
        await ctx.db.patch(authorId, {
          articleCount: Math.max(0, (author.articleCount ?? 0) - delta),
          updatedAt: now,
        })
    }
    return { applied: true, articles: preview }
  },
})

// Admin: set all articles to draft (for testing empty homepage). Run via CLI:
// npx convex run articles:setAllArticlesToDraft
export const setAllArticlesToDraft = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query('articles').collect()
    const now = Date.now()
    let updated = 0
    for (const article of articles) {
      if (article.published) {
        await removeTagLinksForArticle(ctx, article._id)
        await syncReadingRoomArticle(ctx, article._id, null)
        await ctx.db.patch(article._id, {
          published: false,
          updatedAt: now,
        })
        updated += 1
      }
    }
    return { updated }
  },
})
