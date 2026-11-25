import { confirmedTipPatch } from './lib/verifiedTips'
import { syncReadingRoomEngagement } from './lib/readingRoomIndex'
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
  HORIZON_NOT_FOUND_TERMINAL_REASON,
  TIP_ARTICLE_FUNCTIONS,
  getTippingContractId,
  isPastHorizonNotFoundIndexingGrace,
  verifyDelayMs,
} from './lib/constants'
import { resolveHorizonUrl } from './stellarVerify'
import { creditAuthorEarnings, writerShareCents } from './lib/authorEarnings'

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
      !tip.expectedMinTime ||
      !tip.expectedMaxTime ||
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
        expectedTimeBounds: {
          minTime: tip.expectedMinTime,
          maxTime: tip.expectedMaxTime,
        },
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
        if (
          result.reason === 'not_found' &&
          isPastHorizonNotFoundIndexingGrace(tip.expectedMaxTime)
        ) {
          await ctx.runMutation(
            internal.articleTipVerify.markArticleTipFailed,
            {
              tipId: args.tipId,
              reason: HORIZON_NOT_FOUND_TERMINAL_REASON,
            }
          )
          return null
        }
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
      ...confirmedTipPatch(now),
      stellarLedger: args.stellarLedger,
      failureReason: undefined,
    })

    const article = await ctx.db.get(tip.articleId)
    if (article) {
      const tipCount = (article.tipCount || 0) + 1
      await ctx.db.patch(tip.articleId, {
        tipCount,
        totalTipsUsd: (article.totalTipsUsd || 0) + tip.amountUsd,
        updatedAt: now,
      })
      await syncReadingRoomEngagement(ctx, tip.articleId, { tipCount })
    }

    await creditAuthorEarnings(ctx, {
      authorId: tip.authorId,
      articleId: tip.articleId,
      articleTitle: tip.articleTitle,
      shareCents: writerShareCents(tip.amountCents, tip.expectedAmountStroops),
      now,
    })

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
