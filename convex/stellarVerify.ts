import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import { verifyTipTransaction } from './lib/horizon'
import { fetchXlmPriceUsd } from './lib/xlmPrice'
import {
  HORIZON_URLS,
  HORIZON_VERIFY_MAX_ATTEMPTS,
  HORIZON_VERIFY_RETRY_DELAY_MS,
  STROOPS_PER_XLM,
  TIP_AMOUNT_USD_TOLERANCE,
  TIP_HIGHLIGHT_FUNCTIONS,
  getTippingContractId,
} from './lib/constants'

/**
 * Internal read used by the verify action to hydrate the tip row (actions
 * cannot read the DB directly — they must go through a query). Kept separate
 * from public queries so we don't accidentally expose the raw row.
 */
export const getHighlightTipForVerify = internalQuery({
  args: { id: v.id('highlightTips') },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip) return null
    const author = await ctx.db.get(tip.authorId)
    return {
      tip,
      authorStellarAddress: author?.stellarAddress ?? null,
    }
  },
})

export function resolveHorizonUrl(network: string | undefined): string {
  const override = process.env.HORIZON_URL
  if (override) return override
  if (network === 'MAINNET') return HORIZON_URLS.MAINNET
  return HORIZON_URLS.TESTNET
}

/**
 * Convert a human-readable XLM amount string ("0.1", "100", "0.0000001") into
 * stroops (1 XLM = 10_000_000 stroops). No float math — works by string-splitting
 * so we don't drop precision on amounts like "0.0454545".
 */
export function xlmStringToStroops(xlm: string): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(xlm)) return null
  const [whole = '0', frac = ''] = xlm.split('.')
  const paddedFrac = frac.padEnd(7, '0').slice(0, 7)
  return BigInt(whole) * BigInt(10_000_000) + BigInt(paddedFrac || '0')
}

/**
 * Verifies a highlight tip against Horizon. The tip must be in status
 * 'PENDING'. On success, flips status to 'CONFIRMED' and credits counters;
 * on a transient failure (propagation lag, Horizon 5xx, network error) the
 * action reschedules itself up to HORIZON_VERIFY_MAX_ATTEMPTS times; on a
 * permanent failure (tx unsuccessful, source mismatch, contract/function
 * mismatch, author/amount mismatch, etc.) the tip is marked 'FAILED' and
 * no counters are touched.
 */
export const verifyHighlightTip = internalAction({
  args: {
    highlightTipId: v.id('highlightTips'),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const hydrated = await ctx.runQuery(
      internal.stellarVerify.getHighlightTipForVerify,
      { id: args.highlightTipId }
    )
    if (!hydrated) return
    const { tip, authorStellarAddress } = hydrated
    if (tip.status !== 'PENDING') return

    if (
      !tip.stellarSourceAccount ||
      !tip.stellarTxId ||
      !tip.stellarAmountXlm
    ) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'missing_stellar_metadata',
      })
      return
    }

    if (!authorStellarAddress) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'missing_author_stellar_address',
      })
      return
    }

    const minStroops = xlmStringToStroops(tip.stellarAmountXlm)
    if (minStroops === null) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'malformed_stellar_amount',
      })
      return
    }

    const horizonUrl = resolveHorizonUrl(tip.stellarNetwork)
    const result = await verifyTipTransaction(fetch, {
      txId: tip.stellarTxId,
      expectedSource: tip.stellarSourceAccount,
      horizonUrl,
      invocation: {
        contractId: getTippingContractId(),
        allowedFunctions: TIP_HIGHLIGHT_FUNCTIONS,
        authorAddress: authorStellarAddress,
        minStroops,
      },
    })

    if (!result.ok) {
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
      return
    }

    // USD cross-check runs in warn-only mode: we never block a tip that
    // already passed contract / function / author / amount-stroops checks,
    // because the price oracle or real XLM volatility could legitimately
    // disagree with the claim. Instead we flag suspicious tips so they
    // can be audited. Flip to hard-fail once we see the real-world
    // divergence distribution in production.
    const suspicion = await computeAmountSuspicion({
      onChainStroops: result.onChainStroops,
      claimedAmountUsd: tip.amountUsd,
    })
    if (suspicion) {
      console.warn(
        `[highlightTip ${args.highlightTipId}] amount-usd check flagged: ${suspicion}`
      )
    }

    await ctx.runMutation(internal.stellarVerify.markHighlightTipConfirmed, {
      id: args.highlightTipId,
      stellarLedger: result.ledger,
      amountUsdSuspicionReason: suspicion ?? undefined,
    })
  },
})

/**
 * Returns a short reason string if the on-chain paid amount disagrees with
 * the tip's claimed USD beyond tolerance, or null if the claim looks fine.
 * Returns `price_oracle_unavailable` when the oracle cannot be reached — we
 * still confirm the tip, but the caller should flag it for audit.
 */
async function computeAmountSuspicion(args: {
  onChainStroops: bigint | null
  claimedAmountUsd: number
}): Promise<string | null> {
  if (args.onChainStroops === null) {
    // Invocation checks were skipped (should not happen in this flow, but
    // defensive). Treat as suspicious rather than silently trusting.
    return 'missing_onchain_amount'
  }

  const price = await fetchXlmPriceUsd(fetch)
  if (!price.ok) {
    return `price_oracle_unavailable:${price.reason}`
  }

  const onChainXlm = Number(args.onChainStroops) / STROOPS_PER_XLM
  const onChainUsd = onChainXlm * price.priceUsd
  const minAcceptableUsd =
    args.claimedAmountUsd * (1 - TIP_AMOUNT_USD_TOLERANCE)
  if (onChainUsd < minAcceptableUsd) {
    return `amount_usd_mismatch:onchain_usd=${onChainUsd.toFixed(4)},claimed_usd=${args.claimedAmountUsd}`
  }
  return null
}

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
    amountUsdSuspicionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip) return
    if (tip.status !== 'PENDING') return

    const now = Date.now()

    const suspicious = Boolean(args.amountUsdSuspicionReason)
    await ctx.db.patch(args.id, {
      status: 'CONFIRMED',
      stellarLedger: args.stellarLedger,
      amountUsdSuspicious: suspicious || undefined,
      amountUsdSuspicionReason: args.amountUsdSuspicionReason,
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
