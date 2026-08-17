import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import { verifyTipTransaction } from './lib/horizon'
import {
  ARTICLE_TIP_TX_EARLY_GRACE_MS,
  ARTICLE_TIP_TX_LATE_GRACE_MS,
  HORIZON_VERIFY_MAX_ATTEMPTS,
  TIP_ARTICLE_FUNCTIONS,
  getTippingContractId,
  verifyDelayMs,
} from './lib/constants'
import { resolveHorizonUrl } from './stellarVerify'

export const getArticleTipForVerify = internalQuery({
  args: { tipId: v.id('tips') },
  returns: v.any(),
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip) return null
    const intent = tip.articleTipIntentId
      ? await ctx.db.get(tip.articleTipIntentId)
      : null
    return { tip, intent }
  },
})

export const verifyArticleTip = internalAction({
  args: {
    tipId: v.id('tips'),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hydrated = await ctx.runQuery(
      internal.articleTipVerify.getArticleTipForVerify,
      { tipId: args.tipId }
    )
    if (!hydrated) return null
    const { tip, intent } = hydrated
    if (tip.status !== 'PENDING') return null

    if (
      !tip.stellarTxId ||
      !tip.expectedSourceAccount ||
      !tip.expectedDestinationAccount ||
      !tip.expectedArticleSymbol ||
      !tip.expectedAmountStroops ||
      !tip.expectedMemo ||
      !intent
    ) {
      await ctx.runMutation(internal.articleTipVerify.markArticleTipFailed, {
        tipId: args.tipId,
        reason: 'missing_verification_expectation',
      })
      return null
    }

    let exactStroops: bigint
    try {
      exactStroops = BigInt(tip.expectedAmountStroops)
    } catch {
      await ctx.runMutation(internal.articleTipVerify.markArticleTipFailed, {
        tipId: args.tipId,
        reason: 'malformed_expected_amount',
      })
      return null
    }

    const result = await verifyTipTransaction(fetch, {
      txId: tip.stellarTxId,
      expectedSource: tip.expectedSourceAccount,
      horizonUrl: resolveHorizonUrl(tip.stellarNetwork),
      minCreatedAtMs: intent.createdAt - ARTICLE_TIP_TX_EARLY_GRACE_MS,
      maxCreatedAtMs: intent.expiresAt + ARTICLE_TIP_TX_LATE_GRACE_MS,
      invocation: {
        contractId:
          tip.expectedContractId ??
          intent.expectedContractId ??
          getTippingContractId(),
        allowedFunctions: TIP_ARTICLE_FUNCTIONS,
        authorAddress: tip.expectedDestinationAccount,
        articleId: tip.expectedArticleSymbol,
        minStroops: exactStroops,
        exactStroops,
        expectedMemo: tip.expectedMemo,
        batchTips: [
          {
            articleId: tip.expectedArticleSymbol,
            authorAddress: tip.expectedDestinationAccount,
            minStroops: exactStroops,
            exactStroops,
          },
        ],
      },
    })

    if (!result.ok) {
      if (result.kind === 'transient') {
        if (args.attempt < HORIZON_VERIFY_MAX_ATTEMPTS) {
          await ctx.scheduler.runAfter(
            verifyDelayMs(args.attempt),
            internal.articleTipVerify.verifyArticleTip,
            { tipId: args.tipId, attempt: args.attempt + 1 }
          )
        } else {
          await ctx.runMutation(
            internal.articleTipVerify.markArticleTipTemporarilyUnavailable,
            { tipId: args.tipId }
          )
        }
        return null
      }

      await ctx.runMutation(internal.articleTipVerify.markArticleTipFailed, {
        tipId: args.tipId,
        reason: result.reason,
      })
      return null
    }

    await ctx.runMutation(internal.articleTipVerify.confirmVerifiedArticleTip, {
      tipId: args.tipId,
      stellarLedger: result.ledger,
    })
    return null
  },
})

export const markArticleTipTemporarilyUnavailable = internalMutation({
  args: { tipId: v.id('tips') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.status !== 'PENDING') return null
    await ctx.db.patch(args.tipId, {
      failureReason: 'verification_temporarily_unavailable',
      updatedAt: Date.now(),
    })
    return null
  },
})

export const markArticleTipFailed = internalMutation({
  args: {
    tipId: v.id('tips'),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.status !== 'PENDING') return null
    const now = Date.now()
    await ctx.db.patch(args.tipId, {
      status: 'FAILED',
      failureReason: args.reason,
      processedAt: now,
      updatedAt: now,
    })
    return null
  },
})

export const confirmVerifiedArticleTip = internalMutation({
  args: {
    tipId: v.id('tips'),
    stellarLedger: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.status !== 'PENDING') return null

    const now = Date.now()
    await ctx.db.patch(args.tipId, {
      status: 'CONFIRMED',
      stellarLedger: args.stellarLedger,
      failureReason: undefined,
      verifiedAt: now,
      processedAt: now,
      updatedAt: now,
    })

    const article = await ctx.db.get(tip.articleId)
    if (article) {
      await ctx.db.patch(tip.articleId, {
        tipCount: (article.tipCount || 0) + 1,
        totalTipsUsd: (article.totalTipsUsd || 0) + tip.amountUsd,
        updatedAt: now,
      })
    }

    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', tip.authorId))
      .first()
    const monthKey = getMonthKey(now)

    if (!earnings) {
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
        monthlyEarnings: { [monthKey]: tip.amountUsd },
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
      const monthlyEarnings = {
        ...earnings.monthlyEarnings,
        [monthKey]: (earnings.monthlyEarnings?.[monthKey] || 0) + tip.amountUsd,
      }
      const topArticles = [...(earnings.topArticles || [])]
      const articleIndex = topArticles.findIndex(
        (entry) => entry.articleId === tip.articleId
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
      topArticles.sort((a, b) => b.earnings - a.earnings)
      topArticles.splice(10)

      const totalEarnedCents = earnings.totalEarnedCents + tip.amountCents
      const availableBalanceCents =
        earnings.availableBalanceCents + tip.amountCents
      await ctx.db.patch(earnings._id, {
        totalEarnedCents,
        totalEarnedUsd: totalEarnedCents / 100,
        availableBalanceCents,
        availableBalanceUsd: availableBalanceCents / 100,
        tipCount: earnings.tipCount + 1,
        lastTipAt: now,
        monthlyEarnings,
        topArticles,
        updatedAt: now,
      })
    }

    const [tipper, author] = await Promise.all([
      ctx.db.get(tip.tipperId),
      ctx.db.get(tip.authorId),
    ])
    if (tipper) {
      await ctx.db.patch(tip.tipperId, {
        tipsSentCount: (tipper.tipsSentCount || 0) + 1,
        updatedAt: now,
      })
    }
    if (author) {
      await ctx.db.patch(tip.authorId, {
        tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
        updatedAt: now,
      })
    }
    return null
  },
})

function getMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
