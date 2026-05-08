import { ConvexError, v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import { enrichWithUser } from './lib/enrich'
import { TIP_MIN_USD, TIP_MAX_USD, MIN_WITHDRAWAL_USD } from './lib/constants'
import { checkTipCooldown, enforceTipCooldown } from './lib/rateLimit'

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

// Get the caller's full tip history. Intentionally returns rows in every status
// (PENDING / CONFIRMED / FAILED / FRAUDULENT) so the tipper sees in-flight and
// rejected tips in their own history — do NOT add a `status === 'CONFIRMED'`
// filter here. Public-facing aggregations (article counters, leaderboards)
// have their own CONFIRMED-only filters.
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

// Pre-flight cooldown check used by the UI before starting the Stellar signing
// flow. Returning { allowed: true } for unauthenticated callers keeps anonymous
// page views from ever seeing a false rate-limit signal; the sendTip mutation
// still requires authentication as usual.
export const canTip = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return { allowed: true as const }
    return await checkTipCooldown(ctx, userId)
  },
})

// Send tip mutation
export const sendTip = mutation({
  args: {
    articleId: v.id('articles'),
    amountUsd: v.number(),
    message: v.optional(v.string()),
    stellarTxId: v.string(),
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

    // Dedup: Convex mutations have at-least-once delivery, so a lost ack
    // could cause the client to retry and insert a duplicate row. Non-empty
    // stellarTxIds are unique per Stellar transaction, so we look up by index
    // and return the existing row if found. Empty stellarTxIds are not deduped
    // because two unrelated tips could legitimately share that sentinel value.
    //
    // We additionally require articleId AND tipperId to match the existing
    // row before short-circuiting. A txId reused across a different article
    // or by a different user is never a legit retry — silently returning the
    // mismatched original would tell the caller "your tip succeeded" when in
    // fact no tip on the requested article was created. Reject explicitly.
    if (args.stellarTxId !== '') {
      const existing = await ctx.db
        .query('tips')
        .withIndex('by_stellar_tx', (q) =>
          q.eq('stellarTxId', args.stellarTxId)
        )
        .first()
      if (existing) {
        if (
          existing.articleId === args.articleId &&
          existing.tipperId === userId
        ) {
          return existing._id
        }
        throw new ConvexError(
          'This Stellar transaction is already linked to a different tip.'
        )
      }
    }

    // Cooldown check runs after the dedup short-circuit so that at-least-once
    // retries of the same Stellar tx are not mistaken for spam.
    await enforceTipCooldown(ctx, userId)

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

    // Create tip record (initially pending). Stellar metadata is persisted
    // at insert time so the reconciliation job can verify the on-chain tx
    // later without relying on confirmTip to stamp a placeholder.
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
      stellarTxId: args.stellarTxId,
      stellarNetwork: args.stellarNetwork || 'TESTNET',
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: args.stellarSourceAccount,
      stellarDestinationAccount: args.stellarDestinationAccount,
      stellarAmountXlm: args.stellarAmountXlm,
      contractTipId: args.contractTipId,
      platformFee: args.platformFee,
      authorShare: args.authorShare,
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
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip) throw new Error('Tip not found')
    if (tip.status !== 'PENDING') return

    const now = Date.now()

    // Flip status to CONFIRMED. stellarTxId was stored at insert time by
    // sendTip, so there's nothing to stamp here.
    await ctx.db.patch(args.tipId, {
      status: 'CONFIRMED',
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

// Internal mutation: mark a previously-CONFIRMED tip as FRAUDULENT and reverse
// every counter/earnings increment that confirmTip applied. Called exclusively
// by the reconciliation action when on-chain verification proves the tip was
// faked (e.g., no matching Stellar tx, wrong contract, wrong recipient).
//
// Idempotent: safe to call twice on the same tip; the second call is a no-op.
// Guarded: only reverses CONFIRMED tips. PENDING/FAILED tips never had counters
// credited, so reversal would decrement into negatives.
export const markArticleTipFraudulent = internalMutation({
  args: {
    tipId: v.id('tips'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip) return
    if (tip.status === 'FRAUDULENT') return
    if (tip.status !== 'CONFIRMED') {
      console.warn(
        '[reconcileTips] markArticleTipFraudulent skipped: tip not CONFIRMED',
        { tipId: args.tipId, currentStatus: tip.status }
      )
      return
    }

    const now = Date.now()

    // Flip tip status + record reason
    await ctx.db.patch(args.tipId, {
      status: 'FRAUDULENT',
      failureReason: args.reason,
      processedAt: now,
      updatedAt: now,
    })

    // Reverse article counters
    const article = await ctx.db.get(tip.articleId)
    if (article) {
      await ctx.db.patch(tip.articleId, {
        tipCount: Math.max(0, (article.tipCount || 0) - 1),
        totalTipsUsd: Math.max(0, (article.totalTipsUsd || 0) - tip.amountUsd),
      })
    }

    // Reverse authorEarnings
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', tip.authorId))
      .first()

    if (!earnings) {
      console.warn(
        '[reconcileTips] markArticleTipFraudulent: no authorEarnings row for CONFIRMED tip; skipping earnings reversal',
        { tipId: args.tipId, authorId: tip.authorId }
      )
    } else {
      const monthKey = getMonthKey(tip.createdAt)
      const monthlyEarnings = { ...(earnings.monthlyEarnings || {}) }
      const newMonthlyValue = Math.max(
        0,
        (monthlyEarnings[monthKey] || 0) - tip.amountUsd
      )
      if (newMonthlyValue === 0) {
        delete monthlyEarnings[monthKey]
      } else {
        monthlyEarnings[monthKey] = newMonthlyValue
      }

      // Reverse topArticles entry. If both earnings and tipCount hit zero,
      // drop the entry entirely. Re-sort descending but do not re-splice to
      // top 10: a decrement here could have pushed a hidden article into
      // range, but we cannot recover that state from this code path.
      const topArticles = [...(earnings.topArticles || [])]
      const articleIndex = topArticles.findIndex(
        (a) => a.articleId === tip.articleId
      )
      if (articleIndex >= 0 && topArticles[articleIndex]) {
        const entry = topArticles[articleIndex]
        const newEarnings = Math.max(0, entry.earnings - tip.amountUsd)
        const newTipCount = Math.max(0, entry.tipCount - 1)
        if (newEarnings === 0 && newTipCount === 0) {
          topArticles.splice(articleIndex, 1)
        } else {
          entry.earnings = newEarnings
          entry.tipCount = newTipCount
        }
        topArticles.sort((a, b) => b.earnings - a.earnings)
      }

      const newTotalCents = Math.max(
        0,
        earnings.totalEarnedCents - tip.amountCents
      )
      const newAvailableCents = Math.max(
        0,
        earnings.availableBalanceCents - tip.amountCents
      )
      await ctx.db.patch(earnings._id, {
        totalEarnedCents: newTotalCents,
        totalEarnedUsd: newTotalCents / 100,
        availableBalanceCents: newAvailableCents,
        availableBalanceUsd: newAvailableCents / 100,
        tipCount: Math.max(0, earnings.tipCount - 1),
        monthlyEarnings,
        topArticles,
        updatedAt: now,
      })
    }

    // Reverse user stats
    const [tipper, author] = await Promise.all([
      ctx.db.get(tip.tipperId),
      ctx.db.get(tip.authorId),
    ])

    if (tipper) {
      await ctx.db.patch(tip.tipperId, {
        tipsSentCount: Math.max(0, (tipper.tipsSentCount || 0) - 1),
      })
    }

    if (author) {
      await ctx.db.patch(tip.authorId, {
        tipsReceivedCount: Math.max(0, (author.tipsReceivedCount || 0) - 1),
      })
    }

    console.error('[reconcileTips] marked FRAUDULENT', {
      tipId: args.tipId,
      articleId: tip.articleId,
      tipperId: tip.tipperId,
      authorId: tip.authorId,
      amountUsd: tip.amountUsd,
      reason: args.reason,
    })

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
