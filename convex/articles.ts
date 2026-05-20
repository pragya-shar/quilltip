import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { query, mutation, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { getAuthUserId } from '@convex-dev/auth/server'
import { enrichWithUser } from './lib/enrich'
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
  extractTextFromTiptapJson,
  tiptapJsonHasNonEmptyText,
} from './lib/tiptapContent'

const WRITER_NOTES_MAX_LENGTH = 5000

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

// List articles with pagination and filters
export const listArticles = query({
  args: {
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
    tag: v.optional(v.string()),
    author: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(args.page || 1, 1)
    const limit = Math.min(Math.max(args.limit || 10, 1), 50)
    const offset = (page - 1) * limit

    const tag = args.tag?.trim() || undefined
    const searchRaw = args.search?.trim()
    const search =
      searchRaw && searchRaw.length > 0 ? searchRaw.slice(0, 200) : undefined

    let authorId: Id<'users'> | undefined
    if (args.author) {
      const author = await ctx.db
        .query('users')
        .withIndex('by_username', (q) => q.eq('username', args.author!))
        .first()

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

    if (search) {
      // FTS: tokenized (whitespace/punctuation, terms up to 32 chars, lowercased), not raw
      // substring matches; prefix on the last term per Convex text search. Results are then
      // sorted by publishedAt desc so newest-first matches the by_published_date listing.
      const matches = await ctx.db
        .query('articles')
        .withSearchIndex('search_listing', (q) => {
          let s = q.search('searchContent', search).eq('published', true)
          if (args.author) {
            s = s.eq('authorUsername', args.author!)
          }
          return s
        })
        .collect()

      let rows = matches
      if (tag) {
        rows = rows.filter((a) => a.tags?.includes(tag))
      }
      rows.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      const total = rows.length
      const slice = rows.slice(offset, offset + limit)
      const enrichedArticles = await Promise.all(
        slice.map(async (article) => ({
          ...stripWriterNotes(article),
          author: await enrichWithUser(ctx, article.authorId),
        }))
      )
      return {
        articles: enrichedArticles,
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      }
    }

    if (tag) {
      const linkRows = authorId
        ? await ctx.db
            .query('articleTagLinks')
            .withIndex('by_author_tag_publishedAt', (q) =>
              q.eq('authorId', authorId).eq('tag', tag)
            )
            .order('desc')
            .collect()
        : await ctx.db
            .query('articleTagLinks')
            .withIndex('by_tag_publishedAt', (q) => q.eq('tag', tag))
            .order('desc')
            .collect()
      const total = linkRows.length
      const pageLinks = linkRows.slice(offset, offset + limit)
      const fetched = await Promise.all(
        pageLinks.map((row) => ctx.db.get(row.articleId))
      )
      const articles = fetched.filter(
        (a): a is NonNullable<typeof a> => a?.published === true
      )
      const enrichedArticles = await Promise.all(
        articles.map(async (article) => ({
          ...stripWriterNotes(article),
          author: await enrichWithUser(ctx, article.authorId),
        }))
      )
      return {
        articles: enrichedArticles,
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      }
    }

    let rowsQuery = ctx.db
      .query('articles')
      .withIndex('by_published_date', (q) => q.eq('published', true))
      .order('desc')

    if (authorId) {
      rowsQuery = rowsQuery.filter((q) => q.eq(q.field('authorId'), authorId!))
    }

    const rows = await rowsQuery.collect()
    const total = rows.length
    const slice = rows.slice(offset, offset + limit)
    const enrichedArticles = await Promise.all(
      slice.map(async (article) => ({
        ...stripWriterNotes(article),
        author: await enrichWithUser(ctx, article.authorId),
      }))
    )
    return {
      articles: enrichedArticles,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    }
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

    if (args.published && !tiptapJsonHasNonEmptyText(args.content)) {
      throw new Error('Cannot publish: article body is empty')
    }

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
      readTime: calculateReadTime(args.content),
      createdAt: now,
      updatedAt: now,
    })

    if (args.published) {
      const row = await ctx.db.get(articleId)
      if (row) await replaceTagLinksForArticle(ctx, row)
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
      updates.readTime = calculateReadTime(args.content)
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

    await ctx.db.patch(args.id, updates)

    const updated = await ctx.db.get(args.id)
    if (updated?.published) {
      await replaceTagLinksForArticle(ctx, updated)
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

    // Validate article has required content before publishing
    if (!article.title || article.title.trim().length === 0) {
      throw new Error('Cannot publish: title is required')
    }
    if (!article.content) {
      throw new Error('Cannot publish: content is required')
    }
    if (!tiptapJsonHasNonEmptyText(article.content)) {
      throw new Error('Cannot publish: article body is empty')
    }

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
      searchContent: buildSearchContent(article.title, article.excerpt, {
        tags: article.tags,
        content: article.content,
      }),
      ...(slug !== article.slug ? { slug } : {}),
      ...(shouldUpload ? { arweaveStatus: 'pending' } : {}),
      updatedAt: now,
    })

    const publishedRow = await ctx.db.get(args.id)
    if (publishedRow) await replaceTagLinksForArticle(ctx, publishedRow)

    if (shouldUpload) {
      // Schedule Arweave upload (runs in background)
      await ctx.scheduler.runAfter(0, internal.arweave.uploadArticleToArweave, {
        articleId: args.id,
      })
    }

    // Update user's article count
    const user = await ctx.db.get(userId)
    if (user) {
      await ctx.db.patch(userId, {
        articleCount: (user.articleCount || 0) + 1,
        updatedAt: now,
      })
    }

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
      if (after?.published) await replaceTagLinksForArticle(ctx, after)

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

      return await ctx.db.insert('articles', {
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
        readTime: calculateReadTime(args.content),
        createdAt: now,
        updatedAt: now,
      })
    }
  },
})

// One-off after deploy: bunx convex run internal/articles:backfillArticleTagsAndSearchContent
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

// Helper function to calculate read time
function calculateReadTime(content: unknown): number {
  // Simple estimation: 200 words per minute
  const text = extractTextFromTiptapJson(content)
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(wordCount / 200))
}
