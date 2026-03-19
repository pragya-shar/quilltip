import { v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { getAuthUserId } from '@convex-dev/auth/server'
import { enrichWithUser } from './lib/enrich'

// Helper to generate a unique slug for an article
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateArticleSlug(title: string, authorId: string, ctx: any) {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)

  if (!slug) {
    slug = `article-${Date.now()}`
  }

  const existingSlug = await ctx.db
    .query('articles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .withIndex('by_slug', (q: any) => q.eq('slug', slug))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((q: any) => q.eq(q.field('authorId'), authorId))
    .first()

  return existingSlug ? `${slug}-${Date.now()}` : slug
}

// Validation helper for article input
function validateArticleInput(args: {
  title: string
  excerpt?: string
  tags?: string[]
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

    let articlesQuery = ctx.db
      .query('articles')
      .withIndex('by_published', (q) => q.eq('published', true))

    // Apply filters
    if (args.author) {
      const author = await ctx.db
        .query('users')
        .withIndex('by_username', (q) => q.eq('username', args.author!))
        .first()

      if (!author) return { articles: [], total: 0, page, limit }

      articlesQuery = articlesQuery.filter((q) =>
        q.eq(q.field('authorId'), author._id)
      )
    }

    // Tag filtering would need to be done post-query since tags is an array
    // We'll filter after collecting all articles

    // Search filtering will be done post-query
    // since Convex doesn't support contains on non-indexed fields

    // When no tag/search filter is active, use .take() to avoid loading the entire table
    const hasPostFilters = !!(args.tag || args.search)
    let allArticles
    if (hasPostFilters) {
      // Filters require in-memory processing; cap at 1000 for safety
      allArticles = await articlesQuery.take(1000)
    } else {
      // No post-filters: only take what's needed for this page
      allArticles = await articlesQuery.take(offset + limit + 1)
    }

    // Apply tag filter if specified
    if (args.tag) {
      allArticles = allArticles.filter(
        (article) => article.tags && article.tags.includes(args.tag!)
      )
    }

    // Apply search filter if specified
    if (args.search) {
      const searchLower = args.search.slice(0, 200).toLowerCase()
      allArticles = allArticles.filter(
        (article) =>
          article.title.toLowerCase().includes(searchLower) ||
          (article.excerpt &&
            article.excerpt.toLowerCase().includes(searchLower)) ||
          (article.tags?.some((t) =>
            t.toLowerCase().includes(searchLower)
          ))
      )
    }

    const total = allArticles.length

    // Apply pagination
    const articles = allArticles
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
      .slice(offset, offset + limit)

    // Enrich with author data
    const enrichedArticles = await Promise.all(
      articles.map(async (article) => ({
        ...article,
        author: await enrichWithUser(ctx, article.authorId),
      }))
    )

    return {
      articles: enrichedArticles,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  },
})

// Get unique tags from published articles (for tag cloud / filter UI)
export const getArticleTags = query({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db
      .query('articles')
      .withIndex('by_published', (q) => q.eq('published', true))
      .take(1000)
    const tagSet = new Set<string>()
    for (const article of articles) {
      for (const t of article.tags || []) {
        if (t && typeof t === 'string') tagSet.add(t)
      }
    }
    return Array.from(tagSet).sort()
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
      ...article,
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

    // If unpublished, only the author can view it
    if (!article.published) {
      const userId = await getAuthUserId(ctx)
      if (userId !== article.authorId) return null
    }

    const author = await ctx.db.get(article.authorId)
    return {
      ...article,
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

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    // Generate slug from title
    const finalSlug = await generateArticleSlug(args.title, userId, ctx)

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
      viewCount: 0,
      highlightCount: 0,
      tipCount: 0,
      totalTipsUsd: 0,
      readTime: calculateReadTime(args.content),
      createdAt: now,
      updatedAt: now,
    })

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
      content?: unknown
      readTime?: number
      excerpt?: string
      coverImage?: string
      tags?: string[]
    } = {
      updatedAt: Date.now(),
    }

    if (args.title !== undefined) {
      updates.title = args.title
      // Optionally update slug if title changes significantly
    }

    if (args.content !== undefined) {
      updates.content = args.content
      updates.readTime = calculateReadTime(args.content)
    }

    if (args.excerpt !== undefined) updates.excerpt = args.excerpt
    if (args.coverImage !== undefined) updates.coverImage = args.coverImage
    if (args.tags !== undefined) updates.tags = args.tags

    await ctx.db.patch(args.id, updates)
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

    const now = Date.now()

    // Only schedule Arweave upload if one isn't already pending or completed
    const shouldUpload =
      !article.arweaveStatus || article.arweaveStatus === 'failed'

    await ctx.db.patch(args.id, {
      published: true,
      publishedAt: now,
      ...(shouldUpload ? { arweaveStatus: 'pending' } : {}),
      updatedAt: now,
    })

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

    return args.id
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

    // Delete related data
    // Delete highlights
    const highlights = await ctx.db
      .query('highlights')
      .withIndex('by_article', (q) => q.eq('articleId', args.id))
      .collect()

    for (const highlight of highlights) {
      await ctx.db.delete(highlight._id)
    }

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

// Dev/testing only: unpublish all articles. Run with: npx convex run articles:setAllArticlesToDraft
export const setAllArticlesToDraft = mutation({
  args: {},
  handler: async (ctx) => {
    const publishedArticles = await ctx.db
      .query('articles')
      .withIndex('by_published', (q) => q.eq('published', true))
      .collect()

    const authorCounts = new Map<
      import('./_generated/dataModel').Id<'users'>,
      number
    >()
    for (const article of publishedArticles) {
      await ctx.db.patch(article._id, {
        published: false,
        publishedAt: undefined,
        updatedAt: Date.now(),
      })
      const count = authorCounts.get(article.authorId) ?? 0
      authorCounts.set(article.authorId, count + 1)
    }

    for (const [authorId, count] of authorCounts) {
      const user = await ctx.db.get(authorId)
      if (user) {
        await ctx.db.patch(authorId, {
          articleCount: Math.max(0, (user.articleCount || 0) - count),
          updatedAt: Date.now(),
        })
      }
    }

    return { unpublishCount: publishedArticles.length }
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

      await ctx.db.patch(args.id, {
        title: args.title,
        content: args.content,
        excerpt: args.excerpt,
        coverImage: args.coverImage,
        tags: args.tags,
        updatedAt: Date.now(),
      })

      return args.id
    } else {
      // Create new draft
      // Create new draft
      const user = await ctx.db.get(userId)
      if (!user) throw new Error('User not found')

      const finalSlug = await generateArticleSlug(args.title, userId, ctx)

      const now = Date.now()

      return await ctx.db.insert('articles', {
        slug: finalSlug,
        title: args.title,
        content: args.content,
        excerpt: args.excerpt,
        coverImage: args.coverImage,
        published: false,
        authorId: userId,
        authorUsername: user.username,
        authorName: user.name,
        authorAvatar: user.avatar,
        tags: args.tags || [],
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

// Helper function to extract text from TipTap JSON content
function extractTextFromContent(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromContent).join(' ')
  }
  return ''
}

// Helper function to calculate read time
function calculateReadTime(content: unknown): number {
  // Simple estimation: 200 words per minute
  const text = extractTextFromContent(content)
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(wordCount / 200))
}
