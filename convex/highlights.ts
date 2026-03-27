import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { generateHighlightIdServer } from './lib/highlightHash'
import { enrichWithUser } from './lib/enrich'

// Get highlights for an article
export const getArticleHighlights = query({
  args: {
    articleId: v.id('articles'),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Use by_article index to get all highlights, then filter by isPublic if specified
    const highlightsQuery = ctx.db
      .query('highlights')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))

    let highlights = await highlightsQuery.collect()

    // Filter by isPublic only if explicitly specified
    if (args.isPublic !== undefined) {
      highlights = highlights.filter((h) => h.isPublic === args.isPublic)
    }

    // Enrich with current user data (override denormalized userName/userAvatar
    // so avatar/name changes match the profile without stale snapshots)
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const user = await enrichWithUser(ctx, highlight.userId)
        if (!user) {
          return { ...highlight, user: null }
        }
        return {
          ...highlight,
          user,
          userName: user.name ?? highlight.userName,
          userAvatar: user.avatar,
        }
      })
    )

    return enrichedHighlights
  },
})

// Get user's highlights
export const getUserHighlights = query({
  args: {
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const targetUserId = args.userId || (await getAuthUserId(ctx))
    if (!targetUserId) return []

    const highlights = await ctx.db
      .query('highlights')
      .withIndex('by_user', (q) => q.eq('userId', targetUserId))
      .order('desc')
      .collect()

    // Enrich with article data
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const article = await ctx.db.get(highlight.articleId)
        return {
          ...highlight,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
        }
      })
    )

    return enrichedHighlights
  },
})

// Get user's highlights with tip statistics
export const getUserHighlightsWithTips = query({
  args: {
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const targetUserId = args.userId || (await getAuthUserId(ctx))
    if (!targetUserId) return []

    const highlights = await ctx.db
      .query('highlights')
      .withIndex('by_user', (q) => q.eq('userId', targetUserId))
      .order('desc')
      .collect()

    // Enrich with article data and tip statistics
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const article = await ctx.db.get(highlight.articleId)

        // Get all tips for this highlight (by highlightId hash)
        const tips = await ctx.db
          .query('highlightTips')
          .withIndex('by_highlight', (q) =>
            q.eq('highlightId', highlight.highlightId)
          )
          .collect()

        const tipCount = tips.length
        const totalTipsUsd = tips.reduce(
          (sum, tip) => sum + tip.amountCents / 100,
          0
        )

        return {
          ...highlight,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
          tipStats: {
            count: tipCount,
            totalUsd: totalTipsUsd,
            hasTips: tipCount > 0,
          },
        }
      })
    )

    return enrichedHighlights
  },
})

// Create highlight
export const createHighlight = mutation({
  args: {
    articleId: v.id('articles'),
    text: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.string(),
    endContainerPath: v.string(),
    color: v.optional(v.string()),
    note: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')

    // Validate text length to prevent abuse
    if (args.text.length > 5000) {
      throw new Error('Highlight text too long (max 5000 characters)')
    }

    // Generate deterministic highlight ID (same algorithm as tips)
    const highlightId = await generateHighlightIdServer(
      article.slug,
      args.text,
      args.startOffset,
      args.endOffset
    )

    const now = Date.now()

    const recordId = await ctx.db.insert('highlights', {
      articleId: args.articleId,
      articleTitle: article.title,
      articleSlug: article.slug,
      articleAuthor: article.authorUsername,
      userId,
      userName: user.name,
      userAvatar: user.avatar,
      text: args.text,
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      startContainerPath: args.startContainerPath,
      endContainerPath: args.endContainerPath,
      highlightId, // Store the hash for linking with tips
      color: args.color || '#FFEB3B',
      note: args.note,
      isPublic: args.isPublic !== false,
      createdAt: now,
      updatedAt: now,
    })

    // Update article highlight count
    await ctx.db.patch(args.articleId, {
      highlightCount: (article.highlightCount || 0) + 1,
    })

    // Update user highlight count
    await ctx.db.patch(userId, {
      highlightCount: (user.highlightCount || 0) + 1,
    })

    return recordId
  },
})

// Update highlight
export const updateHighlight = mutation({
  args: {
    id: v.id('highlights'),
    note: v.optional(v.string()),
    color: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const highlight = await ctx.db.get(args.id)
    if (!highlight) throw new Error('Highlight not found')
    if (highlight.userId !== userId) throw new Error('Not authorized')

    const updates: {
      updatedAt: number
      note?: string
      color?: string
      isPublic?: boolean
    } = {
      updatedAt: Date.now(),
    }

    if (args.note !== undefined) updates.note = args.note
    if (args.color !== undefined) updates.color = args.color
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic

    await ctx.db.patch(args.id, updates)
    return args.id
  },
})

// Delete highlight
export const deleteHighlight = mutation({
  args: {
    id: v.id('highlights'),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const highlight = await ctx.db.get(args.id)
    if (!highlight) throw new Error('Highlight not found')
    if (highlight.userId !== userId) throw new Error('Not authorized')

    // Check if highlight has been tipped - tipped highlights cannot be deleted
    const associatedTip = await ctx.db
      .query('highlightTips')
      .withIndex('by_highlight', (q) =>
        q.eq('highlightId', highlight.highlightId)
      )
      .first()

    if (associatedTip) {
      throw new Error(
        'Cannot delete a highlight that has been tipped. Tips are permanent financial records.'
      )
    }

    // Update article highlight count
    const article = await ctx.db.get(highlight.articleId)
    if (article) {
      await ctx.db.patch(highlight.articleId, {
        highlightCount: Math.max(0, (article.highlightCount || 0) - 1),
      })
    }

    // Update user highlight count
    const user = await ctx.db.get(userId)
    if (user) {
      await ctx.db.patch(userId, {
        highlightCount: Math.max(0, (user.highlightCount || 0) - 1),
      })
    }

    await ctx.db.delete(args.id)
    return { success: true }
  },
})
