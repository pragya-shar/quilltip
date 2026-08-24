import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { verifyTipTransaction } from './lib/horizon'
import { fetchXlmPriceUsd } from './lib/xlmPrice'
import {
  normalizeStellarTransactionHash,
  stellarTransactionHashLookupValues,
} from './lib/stellarTransactionHash'
import {
  HORIZON_URLS,
  ARTICLE_TIP_TX_EARLY_GRACE_MS,
  ARTICLE_TIP_TX_LATE_GRACE_MS,
  HORIZON_VERIFY_MAX_ATTEMPTS,
  STROOPS_PER_XLM,
  TIP_AMOUNT_USD_TOLERANCE,
  TIP_HIGHLIGHT_FUNCTIONS,
  getTippingContractId,
  verifyDelayMs,
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
    const [author, intent] = await Promise.all([
      tip.highlightTipIntentId
        ? Promise.resolve(null)
        : ctx.db.get(tip.authorId),
      tip.highlightTipIntentId
        ? ctx.db.get(tip.highlightTipIntentId)
        : Promise.resolve(null),
    ])
    return {
      tip,
      intent,
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

export function resolveIntentHorizonUrl(network: string): string {
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

function matchesHighlightTipIntentSnapshot(
  tip: Doc<'highlightTips'>,
  intent: Doc<'highlightTipIntents'>
): boolean {
  const copiedAmountStroops = tip.stellarAmountXlm
    ? xlmStringToStroops(tip.stellarAmountXlm)?.toString()
    : undefined

  return (
    tip.highlightTipIntentId === intent._id &&
    intent.tipId === tip._id &&
    tip.articleId === intent.articleId &&
    tip.tipperId === intent.tipperId &&
    tip.authorId === intent.authorId &&
    tip.articleTitle === intent.articleTitle &&
    tip.articleSlug === intent.articleSlug &&
    tip.tipperName === intent.tipperName &&
    tip.tipperAvatar === intent.tipperAvatar &&
    tip.authorName === intent.authorName &&
    tip.authorAvatar === intent.authorAvatar &&
    tip.highlightText === intent.highlightText &&
    tip.startOffset === intent.startOffset &&
    tip.endOffset === intent.endOffset &&
    tip.startContainerPath === intent.startContainerPath &&
    tip.endContainerPath === intent.endContainerPath &&
    tip.amountUsd === intent.amountUsd &&
    tip.amountCents === intent.amountCents &&
    tip.message === intent.message &&
    tip.highlightId === intent.expectedHighlightId &&
    tip.stellarNetwork === intent.expectedStellarNetwork &&
    tip.stellarMemo === intent.expectedHighlightId &&
    tip.stellarSourceAccount === intent.expectedSourceAccount &&
    tip.stellarDestinationAccount === intent.expectedDestinationAccount &&
    copiedAmountStroops === intent.expectedAmountStroops &&
    tip.expectedSourceAccount === intent.expectedSourceAccount &&
    tip.expectedDestinationAccount === intent.expectedDestinationAccount &&
    tip.expectedHighlightId === intent.expectedHighlightId &&
    tip.expectedArticleSymbol === intent.expectedArticleSymbol &&
    tip.expectedAmountStroops === intent.expectedAmountStroops &&
    tip.expectedContractId === intent.expectedContractId &&
    tip.expectedMinTime === intent.expectedMinTime &&
    tip.expectedMaxTime === intent.expectedMaxTime &&
    tip.quotePriceUsd === intent.quotePriceUsd &&
    tip.quoteSource === intent.quoteSource &&
    tip.quoteFetchedAt === intent.quoteFetchedAt
  )
}

/**
 * Verifies a highlight tip against Horizon. The tip must be in status
 * 'PENDING'. On success, flips status to 'CONFIRMED' and credits counters;
 * on a transient failure (propagation lag, Horizon 5xx, network error) the
 * action reschedules itself up to HORIZON_VERIFY_MAX_ATTEMPTS times with
 * exponential backoff via verifyDelayMs(); on a permanent failure (tx
 * unsuccessful, source mismatch, contract/function mismatch, author/amount
 * mismatch, etc.) the tip is marked 'FAILED' and no counters are touched.
 *
 * Long-horizon recovery (process crash mid-chain, indexing delays beyond the
 * retry budget) is delegated to recoverStuckPendingHighlightTips in the
 * reconciliation cron — this action's retry only covers fast transients.
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
    const { tip, intent, authorStellarAddress } = hydrated
    if (tip.status !== 'PENDING') return

    if (tip.highlightTipIntentId) {
      if (
        !intent ||
        !tip.stellarTxId ||
        !tip.expectedSourceAccount ||
        !tip.expectedDestinationAccount ||
        !tip.expectedHighlightId ||
        !tip.expectedArticleSymbol ||
        !tip.expectedAmountStroops ||
        !tip.expectedContractId ||
        !tip.expectedMinTime ||
        !tip.expectedMaxTime
      ) {
        await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
          id: args.highlightTipId,
          reason: 'missing_verification_expectation',
        })
        return
      }

      if (!matchesHighlightTipIntentSnapshot(tip, intent)) {
        await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
          id: args.highlightTipId,
          reason: 'verification_expectation_mismatch',
        })
        return
      }

      let exactStroops: bigint
      try {
        exactStroops = BigInt(tip.expectedAmountStroops)
      } catch {
        await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
          id: args.highlightTipId,
          reason: 'malformed_expected_amount',
        })
        return
      }
      if (exactStroops <= BigInt(0)) {
        await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
          id: args.highlightTipId,
          reason: 'malformed_expected_amount',
        })
        return
      }

      const exactResult = await verifyTipTransaction(fetch, {
        txId: tip.stellarTxId,
        expectedSource: tip.expectedSourceAccount,
        horizonUrl: resolveIntentHorizonUrl(tip.stellarNetwork),
        minCreatedAtMs: intent.createdAt - ARTICLE_TIP_TX_EARLY_GRACE_MS,
        maxCreatedAtMs: intent.expiresAt + ARTICLE_TIP_TX_LATE_GRACE_MS,
        invocation: {
          contractId: tip.expectedContractId,
          allowedFunctions: TIP_HIGHLIGHT_FUNCTIONS,
          authorAddress: tip.expectedDestinationAccount,
          highlightId: tip.expectedHighlightId,
          articleId: tip.expectedArticleSymbol,
          minStroops: exactStroops,
          exactStroops,
          expectedTimeBounds: {
            minTime: tip.expectedMinTime,
            maxTime: tip.expectedMaxTime,
          },
          batchTips: [
            {
              highlightId: tip.expectedHighlightId,
              articleId: tip.expectedArticleSymbol,
              authorAddress: tip.expectedDestinationAccount,
              minStroops: exactStroops,
              exactStroops,
            },
          ],
        },
      })

      if (!exactResult.ok) {
        if (exactResult.kind === 'transient') {
          if (args.attempt < HORIZON_VERIFY_MAX_ATTEMPTS) {
            await ctx.scheduler.runAfter(
              verifyDelayMs(args.attempt),
              internal.stellarVerify.verifyHighlightTip,
              {
                highlightTipId: args.highlightTipId,
                attempt: args.attempt + 1,
              }
            )
          } else {
            await ctx.runMutation(
              internal.stellarVerify.markHighlightTipTemporarilyUnavailable,
              { id: args.highlightTipId }
            )
          }
          return
        }

        await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
          id: args.highlightTipId,
          reason: exactResult.reason,
        })
        return
      }

      await ctx.runMutation(
        internal.stellarVerify.confirmVerifiedHighlightTip,
        {
          id: args.highlightTipId,
          stellarLedger: exactResult.ledger,
        }
      )
      return
    }

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
          verifyDelayMs(args.attempt),
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

export const markHighlightTipTemporarilyUnavailable = internalMutation({
  args: { id: v.id('highlightTips') },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip || tip.status !== 'PENDING' || !tip.highlightTipIntentId) return
    await ctx.db.patch(args.id, {
      failureReason: 'verification_temporarily_unavailable',
      updatedAt: Date.now(),
    })
  },
})

/**
 * Atomically settles an exactly verified, intent-backed highlight tip. Every
 * authoritative row is loaded before any write, and the PENDING guard makes
 * repeated scheduler deliveries a no-op.
 */
export const confirmVerifiedHighlightTip = internalMutation({
  args: {
    id: v.id('highlightTips'),
    stellarLedger: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip || tip.status !== 'PENDING' || !tip.highlightTipIntentId) return

    const intent = await ctx.db.get(tip.highlightTipIntentId)
    const now = Date.now()
    if (!intent) {
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: 'missing_verification_expectation',
        processedAt: now,
        updatedAt: now,
      })
      return
    }
    if (!matchesHighlightTipIntentSnapshot(tip, intent)) {
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: 'verification_expectation_mismatch',
        processedAt: now,
        updatedAt: now,
      })
      return
    }

    const normalizedTxId = normalizeStellarTransactionHash(tip.stellarTxId)
    if (!normalizedTxId) {
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: 'missing_verification_expectation',
        processedAt: now,
        updatedAt: now,
      })
      return
    }
    const matchingHashes = (
      await Promise.all(
        stellarTransactionHashLookupValues(normalizedTxId).map((lookupValue) =>
          ctx.db
            .query('highlightTips')
            .withIndex('by_stellar_tx', (q) => q.eq('stellarTxId', lookupValue))
            .collect()
        )
      )
    ).flat()
    if (matchingHashes.some((row) => row._id !== tip._id)) {
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: 'transaction_hash_reused',
        processedAt: now,
        updatedAt: now,
      })
      return
    }

    const [article, tipper, author, earnings] = await Promise.all([
      ctx.db.get(intent.articleId),
      ctx.db.get(intent.tipperId),
      ctx.db.get(intent.authorId),
      ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', intent.authorId))
        .first(),
    ])
    if (!article || !tipper || !author) {
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: 'missing_accounting_record',
        processedAt: now,
        updatedAt: now,
      })
      return
    }

    const monthKey = getMonthKey(now)
    if (!earnings) {
      await ctx.db.insert('authorEarnings', {
        userId: intent.authorId,
        totalEarnedUsd: intent.amountUsd,
        totalEarnedCents: intent.amountCents,
        availableBalanceUsd: intent.amountUsd,
        availableBalanceCents: intent.amountCents,
        pendingBalanceUsd: 0,
        pendingBalanceCents: 0,
        withdrawnUsd: 0,
        withdrawnCents: 0,
        tipCount: 1,
        lastTipAt: now,
        monthlyEarnings: { [monthKey]: intent.amountUsd },
        topArticles: [
          {
            articleId: intent.articleId,
            title: intent.articleTitle,
            earnings: intent.amountUsd,
            tipCount: 1,
          },
        ],
        createdAt: now,
        updatedAt: now,
      })
    } else {
      const monthlyEarnings = {
        ...earnings.monthlyEarnings,
        [monthKey]:
          (earnings.monthlyEarnings?.[monthKey] || 0) + intent.amountUsd,
      }
      const topArticles = [...(earnings.topArticles || [])]
      const articleIndex = topArticles.findIndex(
        (entry) => entry.articleId === intent.articleId
      )
      if (articleIndex >= 0 && topArticles[articleIndex]) {
        topArticles[articleIndex].earnings += intent.amountUsd
        topArticles[articleIndex].tipCount += 1
      } else {
        topArticles.push({
          articleId: intent.articleId,
          title: intent.articleTitle,
          earnings: intent.amountUsd,
          tipCount: 1,
        })
      }
      topArticles.sort((a, b) => b.earnings - a.earnings)
      topArticles.splice(10)

      const totalEarnedCents = earnings.totalEarnedCents + intent.amountCents
      const availableBalanceCents =
        earnings.availableBalanceCents + intent.amountCents
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

    await ctx.db.patch(intent.articleId, {
      tipCount: (article.tipCount || 0) + 1,
      totalTipsUsd: (article.totalTipsUsd || 0) + intent.amountUsd,
      updatedAt: now,
    })
    await ctx.db.patch(intent.tipperId, {
      tipsSentCount: (tipper.tipsSentCount || 0) + 1,
      updatedAt: now,
    })
    await ctx.db.patch(intent.authorId, {
      tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
      updatedAt: now,
    })
    await ctx.db.patch(args.id, {
      status: 'CONFIRMED',
      stellarLedger: args.stellarLedger,
      failureReason: undefined,
      amountUsdSuspicious: undefined,
      amountUsdSuspicionReason: undefined,
      verifiedAt: now,
      processedAt: now,
      updatedAt: now,
    })
  },
})

function getMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

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
    if (!tip || tip.status !== 'PENDING' || tip.highlightTipIntentId) return

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
