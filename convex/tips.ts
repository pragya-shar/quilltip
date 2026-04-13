import { v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import { enrichWithUser } from './lib/enrich'
import { TIP_MIN_USD, TIP_MAX_USD, MIN_WITHDRAWAL_USD } from './lib/constants'

// Get tips for an article
export const getArticleTips = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .order('desc')
      .collect()

    // Enrich with tipper data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => ({
        ...tip,
        tipper: await enrichWithUser(ctx, tip.tipperId),
      }))
    )

    return enrichedTips
  },
})

// Get tip statistics for an article
export const getArticleTipStats = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalTips = tips.length
    const totalAmountUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const uniqueTippers = new Set(tips.map((tip) => tip.tipperId)).size

    return {
      totalTips,
      totalAmountUsd,
      uniqueTippers,
    }
  },
})

// Get user's sent tips
export const getUserSentTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const tips = await ctx.db
      .query('tips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', userId))
      .order('desc')
      .collect()

    // Enrich with article data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => {
        const article = await ctx.db.get(tip.articleId)
        return {
          ...tip,
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

    return enrichedTips
  },
})

// Get user's received tips
export const getUserReceivedTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const tips = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .order('desc')
      .collect()

    // Enrich with tipper and article data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => {
        const [tipper, article] = await Promise.all([
          enrichWithUser(ctx, tip.tipperId),
          ctx.db.get(tip.articleId),
        ])

        return {
          ...tip,
          tipper,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
              }
            : null,
        }
      })
    )

    return enrichedTips
  },
})

// Send tip mutation
export const sendTip = mutation({
  args: {
    articleId: v.id('articles'),
    amountUsd: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')

    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Author not found')

    // Validate message length
    if (args.message && args.message.length > 500) {
      throw new Error('Message must be 500 characters or less')
    }

    // Validate amount (check for NaN, Infinity, and bounds)
    if (
      !Number.isFinite(args.amountUsd) ||
      args.amountUsd < TIP_MIN_USD ||
      args.amountUsd > TIP_MAX_USD
    ) {
      throw new Error('Invalid tip amount')
    }

    // Convert USD to cents for storage (use EPSILON to avoid floating-point precision loss)
    const amountCents = Math.round(args.amountUsd * 100 + Number.EPSILON)

    const now = Date.now()

    // Create tip record (initially pending)
    const tipId = await ctx.db.insert('tips', {
      articleId: args.articleId,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperId: userId,
      tipperName: user.name || user.username,
      tipperAvatar: user.avatar,
      authorId: article.authorId,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      amountUsd: args.amountUsd,
      amountCents,
      message: args.message,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    })

    // In a real implementation, this would trigger a Stellar transaction
    // For now, we'll simulate success after a short delay
    await ctx.scheduler.runAfter(1000, internal.tips.confirmTip, { tipId })

    return tipId
  },
})

// Internal mutation to confirm tip
export const confirmTip = internalMutation({
  args: {
    tipId: v.id('tips'),
    stellarTxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip) throw new Error('Tip not found')
    if (tip.status !== 'PENDING') return

    const now = Date.now()

    // Update tip status
    await ctx.db.patch(args.tipId, {
      status: 'CONFIRMED',
      stellarTxId: args.stellarTxId || `pending_${args.tipId}`,
      updatedAt: now,
    })

    // Update article stats
    const article = await ctx.db.get(tip.articleId)
    if (article) {
      await ctx.db.patch(tip.articleId, {
        tipCount: (article.tipCount || 0) + 1,
        totalTipsUsd: (article.totalTipsUsd || 0) + tip.amountUsd,
      })
    }

    // Update author earnings
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', tip.authorId))
      .first()

    if (!earnings) {
      // Create earnings record
      await ctx.db.insert('authorEarnings', {
        userId: tip.authorId,
        totalEarnedUsd: tip.amountUsd,
        totalEarnedCents: tip.amountCents,
        availableBalanceUsd: tip.amountUsd,
        availableBalanceCents: tip.amountCents,
        pendingBalanceUsd: 0,
        pendingBalanceCents: 0,
        withdrawnUsd: 0,
        withdrawnCents: 0,
        tipCount: 1,
        lastTipAt: now,
        monthlyEarnings: {
          [getMonthKey(now)]: tip.amountUsd,
        },
        topArticles: [
          {
            articleId: tip.articleId,
            title: tip.articleTitle,
            earnings: tip.amountUsd,
            tipCount: 1,
          },
        ],
        createdAt: now,
        updatedAt: now,
      })
    } else {
      // Update earnings record
      const monthKey = getMonthKey(now)
      const monthlyEarnings = {
        ...earnings.monthlyEarnings,
        [monthKey]: (earnings.monthlyEarnings?.[monthKey] || 0) + tip.amountUsd,
      }

      // Update top articles
      const topArticles = [...(earnings.topArticles || [])]
      const articleIndex = topArticles.findIndex(
        (a) => a.articleId === tip.articleId
      )

      if (articleIndex >= 0 && topArticles[articleIndex]) {
        topArticles[articleIndex].earnings += tip.amountUsd
        topArticles[articleIndex].tipCount += 1
      } else {
        topArticles.push({
          articleId: tip.articleId,
          title: tip.articleTitle,
          earnings: tip.amountUsd,
          tipCount: 1,
        })
      }

      // Sort and keep top 10
      topArticles.sort((a, b) => b.earnings - a.earnings)
      topArticles.splice(10)

      const newTotalCents = earnings.totalEarnedCents + tip.amountCents
      const newAvailableCents = earnings.availableBalanceCents + tip.amountCents
      await ctx.db.patch(earnings._id, {
        totalEarnedCents: newTotalCents,
        totalEarnedUsd: newTotalCents / 100,
        availableBalanceCents: newAvailableCents,
        availableBalanceUsd: newAvailableCents / 100,
        tipCount: earnings.tipCount + 1,
        lastTipAt: now,
        monthlyEarnings,
        topArticles,
        updatedAt: now,
      })
    }

    // Update user stats
    const [tipper, author] = await Promise.all([
      ctx.db.get(tip.tipperId),
      ctx.db.get(tip.authorId),
    ])

    if (tipper) {
      await ctx.db.patch(tip.tipperId, {
        tipsSentCount: (tipper.tipsSentCount || 0) + 1,
      })
    }

    if (author) {
      await ctx.db.patch(tip.authorId, {
        tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
      })
    }

    return { success: true }
  },
})

// Get author earnings
export const getAuthorEarnings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    return earnings
  },
})

// Withdraw earnings mutation
export const withdrawEarnings = mutation({
  args: {
    amountUsd: v.number(),
    stellarAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    // Validate Stellar address format
    if (!args.stellarAddress || !/^G[A-Z2-7]{55}$/.test(args.stellarAddress)) {
      throw new Error('Invalid Stellar address format')
    }

    // Get author earnings
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!earnings) {
      throw new Error('No earnings found')
    }

    // Validate withdrawal amount (reject NaN, Infinity, and non-positive)
    if (!Number.isFinite(args.amountUsd) || args.amountUsd <= 0) {
      throw new Error('Invalid withdrawal amount')
    }

    if (args.amountUsd > earnings.availableBalanceUsd) {
      throw new Error('Insufficient balance')
    }

    if (args.amountUsd < MIN_WITHDRAWAL_USD) {
      throw new Error(`Minimum withdrawal amount is $${MIN_WITHDRAWAL_USD}`)
    }

    const amountCents = Math.round(args.amountUsd * 100 + Number.EPSILON)
    const now = Date.now()

    // Create withdrawal record
    const withdrawalId = await ctx.db.insert('withdrawals', {
      userId,
      amountUsd: args.amountUsd,
      amountCents,
      stellarAddress: args.stellarAddress,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    })

    // Update earnings - move from available to pending (compute from cents)
    const newAvailableCents = earnings.availableBalanceCents - amountCents
    const newPendingCents = earnings.pendingBalanceCents + amountCents
    await ctx.db.patch(earnings._id, {
      availableBalanceCents: newAvailableCents,
      availableBalanceUsd: newAvailableCents / 100,
      pendingBalanceCents: newPendingCents,
      pendingBalanceUsd: newPendingCents / 100,
      updatedAt: now,
    })

    // In production, this would trigger a Stellar transaction
    // For now, simulate success after delay
    await ctx.scheduler.runAfter(2000, internal.tips.confirmWithdrawal, {
      withdrawalId,
      earningsId: earnings._id,
    })

    return withdrawalId
  },
})

// Internal mutation to confirm withdrawal
export const confirmWithdrawal = internalMutation({
  args: {
    withdrawalId: v.id('withdrawals'),
    earningsId: v.id('authorEarnings'),
    stellarTxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const withdrawal = await ctx.db.get(args.withdrawalId)
    if (!withdrawal) throw new Error('Withdrawal not found')
    if (withdrawal.status !== 'PENDING') return

    const earnings = await ctx.db.get(args.earningsId)
    if (!earnings) throw new Error('Earnings record not found')

    const now = Date.now()

    // Update withdrawal status
    await ctx.db.patch(args.withdrawalId, {
      status: 'COMPLETED',
      stellarTxId: args.stellarTxId || `pending_${args.withdrawalId}`,
      completedAt: now,
      updatedAt: now,
    })

    // Update earnings - move from pending to withdrawn (compute from cents)
    const newPendingCents =
      earnings.pendingBalanceCents - withdrawal.amountCents
    const newWithdrawnCents = earnings.withdrawnCents + withdrawal.amountCents
    await ctx.db.patch(args.earningsId, {
      pendingBalanceCents: newPendingCents,
      pendingBalanceUsd: newPendingCents / 100,
      withdrawnCents: newWithdrawnCents,
      withdrawnUsd: newWithdrawnCents / 100,
      lastWithdrawalAt: now,
      updatedAt: now,
    })

    return { success: true }
  },
})

// Helper function to get month key
function getMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
