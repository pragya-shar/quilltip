import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import { verifyTipTransaction } from './lib/horizon'
import {
  HORIZON_URLS,
  HORIZON_VERIFY_MAX_ATTEMPTS,
  HORIZON_VERIFY_RETRY_DELAY_MS,
} from './lib/constants'

/**
 * Internal read used by the verify action to hydrate the tip row (actions
 * cannot read the DB directly — they must go through a query). Kept separate
 * from public queries so we don't accidentally expose the raw row.
 */
export const getHighlightTipForVerify = internalQuery({
  args: { id: v.id('highlightTips') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

function resolveHorizonUrl(network: string | undefined): string {
  const override = process.env.HORIZON_URL
  if (override) return override
  if (network === 'MAINNET') return HORIZON_URLS.MAINNET
  return HORIZON_URLS.TESTNET
}

/**
 * Verifies a highlight tip against Horizon. The tip must be in status
 * 'PENDING'. On success, flips status to 'CONFIRMED' and credits counters;
 * on a transient failure (propagation lag, Horizon 5xx, network error) the
 * action reschedules itself up to HORIZON_VERIFY_MAX_ATTEMPTS times; on a
 * permanent failure (tx unsuccessful, source mismatch, etc.) the tip is
 * marked 'FAILED' and no counters are touched.
 */
export const verifyHighlightTip = internalAction({
  args: {
    highlightTipId: v.id('highlightTips'),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.runQuery(
      internal.stellarVerify.getHighlightTipForVerify,
      { id: args.highlightTipId }
    )
    if (!tip) return
    if (tip.status !== 'PENDING') return

    if (!tip.stellarSourceAccount || !tip.stellarTxId) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'missing_stellar_metadata',
      })
      return
    }

    const horizonUrl = resolveHorizonUrl(tip.stellarNetwork)
    const result = await verifyTipTransaction(fetch, {
      txId: tip.stellarTxId,
      expectedSource: tip.stellarSourceAccount,
      horizonUrl,
    })

    if (result.ok) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipConfirmed, {
        id: args.highlightTipId,
        stellarLedger: result.ledger,
      })
      return
    }

    if (
      result.kind === 'transient' &&
      args.attempt < HORIZON_VERIFY_MAX_ATTEMPTS
    ) {
      await ctx.scheduler.runAfter(
        HORIZON_VERIFY_RETRY_DELAY_MS,
        internal.stellarVerify.verifyHighlightTip,
        { highlightTipId: args.highlightTipId, attempt: args.attempt + 1 }
      )
      return
    }

    const reason =
      result.kind === 'transient'
        ? `verification_unreachable:${result.reason}`
        : result.reason

    await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
      id: args.highlightTipId,
      reason,
    })
  },
})

/**
 * Flips a PENDING highlight tip to CONFIRMED and applies the counter updates
 * that `highlightTips.create` intentionally deferred. Idempotent: a second
 * call on an already-settled tip is a no-op. This is what makes the Convex
 * at-least-once scheduler safe.
 */
export const markHighlightTipConfirmed = internalMutation({
  args: {
    id: v.id('highlightTips'),
    stellarLedger: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip) return
    if (tip.status !== 'PENDING') return

    const now = Date.now()

    await ctx.db.patch(args.id, {
      status: 'CONFIRMED',
      stellarLedger: args.stellarLedger,
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

    const tipper = await ctx.db.get(tip.tipperId)
    if (tipper) {
      await ctx.db.patch(tip.tipperId, {
        tipsSentCount: (tipper.tipsSentCount || 0) + 1,
        updatedAt: now,
      })
    }

    const author = await ctx.db.get(tip.authorId)
    if (author) {
      await ctx.db.patch(tip.authorId, {
        tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
        updatedAt: now,
      })
    }
  },
})

/**
 * Flips a PENDING highlight tip to FAILED with a reason string. Counters
 * were never touched at insert time, so there is nothing to roll back.
 * Idempotent.
 */
export const markHighlightTipFailed = internalMutation({
  args: {
    id: v.id('highlightTips'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip) return
    if (tip.status !== 'PENDING') return

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'FAILED',
      failureReason: args.reason,
      processedAt: now,
      updatedAt: now,
    })
  },
})
