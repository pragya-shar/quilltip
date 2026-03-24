import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { TIP_MIN_CENTS, TIP_MAX_CENTS } from './lib/constants'

/**
 * Create a new highlight tip after Stellar transaction
 */
export const create = mutation({
  args: {
    highlightId: v.string(),
    articleId: v.id('articles'),
    highlightText: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.optional(v.string()),
    endContainerPath: v.optional(v.string()),
    amountCents: v.number(),
    stellarTxId: v.string(),
    stellarMemo: v.string(),
    stellarNetwork: v.optional(v.string()),
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    stellarSourceAccount: v.optional(v.string()),
    stellarDestinationAccount: v.optional(v.string()),
    stellarAmountXlm: v.optional(v.string()),
    contractTipId: v.optional(v.string()),
    platformFee: v.optional(v.number()),
    authorShare: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Get user data
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    // Get article data
    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')

    // Get author data
    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Author not found')

    // Validate highlight text length
    if (args.highlightText.length > 5000) {
      throw new Error('Highlight text too long (max 5000 characters)')
    }

    // Validate tip amount (must be between $0.01 and $100)
    if (
      !Number.isFinite(args.amountCents) ||
      args.amountCents < TIP_MIN_CENTS ||
      args.amountCents > TIP_MAX_CENTS
    ) {
      throw new Error(
        `Tip amount must be between $${(TIP_MIN_CENTS / 100).toFixed(2)} and $${(TIP_MAX_CENTS / 100).toFixed(0)}`
      )
    }

    const amountUsd = args.amountCents / 100

    // Insert highlight tip
    const highlightTipId = await ctx.db.insert('highlightTips', {
      // Core references
      highlightId: args.highlightId,
      articleId: args.articleId,
      tipperId: userId,
      authorId: article.authorId,

      // Denormalized data
      highlightText: args.highlightText,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: user.name,
      tipperAvatar: user.avatar,
      authorName: author.name,
      authorAvatar: author.avatar,

      // Tip details
      amountUsd,
      amountCents: args.amountCents,

      // Stellar transaction data
      stellarTxId: args.stellarTxId,
      stellarNetwork: args.stellarNetwork || 'TESTNET',
      stellarMemo: args.stellarMemo,
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: args.stellarSourceAccount,
      stellarDestinationAccount: args.stellarDestinationAccount,
      stellarAmountXlm: args.stellarAmountXlm,
      contractTipId: args.contractTipId,

      // Position data
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      startContainerPath: args.startContainerPath,
      endContainerPath: args.endContainerPath,

      // Status
      status: 'CONFIRMED',
      platformFee: args.platformFee,
      authorShare: args.authorShare,

      // Timestamps
      createdAt: Date.now(),
      processedAt: Date.now(),
      updatedAt: Date.now(),
    })

    // Update article tip stats (tipCount and totalTipsUsd, not highlightCount)
    await ctx.db.patch(args.articleId, {
      tipCount: (article.tipCount || 0) + 1,
      totalTipsUsd: (article.totalTipsUsd || 0) + amountUsd,
      updatedAt: Date.now(),
    })

    // Update user tip counts
    await ctx.db.patch(userId, {
      tipsSentCount: (user.tipsSentCount || 0) + 1,
      updatedAt: Date.now(),
    })

    await ctx.db.patch(article.authorId, {
      tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
      updatedAt: Date.now(),
    })

    return highlightTipId
  },
})

/**
 * Get all tips for a specific highlight
 */
export const getByHighlight = query({
  args: {
    highlightId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_highlight', (q) => q.eq('highlightId', args.highlightId))
      .collect()
  },
})

/**
 * Get all highlight tips for an article (for heatmap)
 */
export const getByArticle = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .collect()
  },
})

/**
 * Get highlight tips by tipper (user's tipping history)
 */
export const getByTipper = query({
  args: {
    tipperId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', args.tipperId))
      .order('desc')
      .collect()
  },
})

/**
 * Get highlight tips received by author
 */
export const getByAuthor = query({
  args: {
    authorId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', args.authorId))
      .order('desc')
      .collect()
  },
})

/**
 * Get aggregate stats for an article's highlight tips
 */
export const getArticleStats = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .collect()

    const totalTips = tips.length
    const totalAmountCents = tips.reduce((sum, tip) => sum + tip.amountCents, 0)
    const uniqueTippers = new Set(tips.map((tip) => tip.tipperId)).size

    // Group by highlight ID to find most tipped highlights
    type HighlightGroup = {
      highlightId: string
      text: string
      startOffset: number
      endOffset: number
      totalAmountCents: number
      tipCount: number
    }

    const highlightGroups = tips.reduce(
      (acc, tip) => {
        if (!acc[tip.highlightId]) {
          acc[tip.highlightId] = {
            highlightId: tip.highlightId,
            text: tip.highlightText,
            startOffset: tip.startOffset,
            endOffset: tip.endOffset,
            totalAmountCents: 0,
            tipCount: 0,
          }
        }
        const group = acc[tip.highlightId]!
        group.totalAmountCents += tip.amountCents
        group.tipCount += 1
        return acc
      },
      {} as Record<string, HighlightGroup>
    )

    const topHighlights = Object.values(highlightGroups)
      .sort((a, b) => b.totalAmountCents - a.totalAmountCents)
      .slice(0, 10)

    return {
      totalTips,
      totalAmountCents,
      totalAmountUsd: totalAmountCents / 100,
      uniqueTippers,
      topHighlights,
    }
  },
})
