import { confirmedTipPatch } from './lib/verifiedTips'
import { syncReadingRoomEngagement } from './lib/readingRoomIndex'
import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { verifyTipTransaction } from './lib/horizon'
import { creditAuthorEarnings, writerShareCents } from './lib/authorEarnings'
import {
  normalizeStellarTransactionHash,
  stellarTransactionHashLookupValues,
} from './lib/stellarTransactionHash'
import { backendVerificationHorizonUrl } from './lib/networkGuard'
import {
  ARTICLE_TIP_TX_EARLY_GRACE_MS,
  ARTICLE_TIP_TX_LATE_GRACE_MS,
  HORIZON_VERIFY_MAX_ATTEMPTS,
  HORIZON_NOT_FOUND_TERMINAL_REASON,
  HORIZON_NOT_FOUND_INDEXING_GRACE_MS,
  TIP_HIGHLIGHT_FUNCTIONS,
  LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
  isPastHorizonNotFoundIndexingGrace,
  verifyDelayMs,
} from './lib/constants'

const LEGACY_HIGHLIGHT_TIP_TX_EARLY_GRACE_MS = 5 * 60 * 1000

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
    const intent = tip.highlightTipIntentId
      ? await ctx.db.get(tip.highlightTipIntentId)
      : null
    return {
      tip,
      intent,
    }
  },
})

// Both resolvers go through the testnet guard: a row recorded on any other
// network, or a mainnet HORIZON_URL override, throws instead of reaching a
// mainnet endpoint.
export function resolveHorizonUrl(network: string | undefined): string {
  return backendVerificationHorizonUrl(network, { allowOverride: true })
}

export function resolveIntentHorizonUrl(network: string | undefined): string {
  return backendVerificationHorizonUrl(network, { allowOverride: false })
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
    tip.expectedFunction === intent.expectedFunction &&
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
    generation: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const hydrated = await ctx.runQuery(
      internal.stellarVerify.getHighlightTipForVerify,
      { id: args.highlightTipId }
    )
    if (!hydrated) return
    const { tip, intent } = hydrated
    if (tip.status !== 'PENDING') return
    const generation = args.generation ?? tip.verificationGeneration ?? 0
    if ((tip.verificationGeneration ?? 0) !== generation) return

    if (!tip.highlightTipIntentId) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
        generation,
      })
      return
    }

    if (
      !intent ||
      !tip.stellarTxId ||
      !tip.expectedSourceAccount ||
      !tip.expectedDestinationAccount ||
      !tip.expectedHighlightId ||
      !tip.expectedArticleSymbol ||
      !tip.expectedAmountStroops ||
      !tip.expectedContractId ||
      !tip.expectedFunction ||
      (!intent.legacyCompatibility &&
        (!tip.expectedMinTime || !tip.expectedMaxTime))
    ) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'missing_verification_expectation',
        generation,
      })
      return
    }

    if (!matchesHighlightTipIntentSnapshot(tip, intent)) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'verification_expectation_mismatch',
        generation,
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
        generation,
      })
      return
    }
    if (exactStroops <= BigInt(0)) {
      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: 'malformed_expected_amount',
        generation,
      })
      return
    }

    const isLegacyCompatibility = intent.legacyCompatibility === true
    const exactResult = await verifyTipTransaction(fetch, {
      txId: tip.stellarTxId ?? '',
      expectedSource: tip.expectedSourceAccount,
      horizonUrl: resolveIntentHorizonUrl(tip.stellarNetwork),
      minCreatedAtMs:
        intent.createdAt -
        (isLegacyCompatibility
          ? LEGACY_HIGHLIGHT_TIP_TX_EARLY_GRACE_MS
          : ARTICLE_TIP_TX_EARLY_GRACE_MS),
      maxCreatedAtMs: isLegacyCompatibility
        ? intent.createdAt + ARTICLE_TIP_TX_LATE_GRACE_MS
        : intent.expiresAt + ARTICLE_TIP_TX_LATE_GRACE_MS,
      invocation: {
        contractId: tip.expectedContractId,
        allowedFunctions: TIP_HIGHLIGHT_FUNCTIONS,
        expectedFunction: tip.expectedFunction,
        authorAddress: tip.expectedDestinationAccount,
        highlightId: tip.expectedHighlightId,
        articleId: tip.expectedArticleSymbol,
        minStroops: exactStroops,
        exactStroops,
        ...(isLegacyCompatibility
          ? {}
          : {
              expectedTimeBounds: {
                minTime: tip.expectedMinTime!,
                maxTime: tip.expectedMaxTime!,
              },
            }),
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
        if (
          exactResult.reason === 'not_found' &&
          (isLegacyCompatibility
            ? Date.now() >
              intent.createdAt + HORIZON_NOT_FOUND_INDEXING_GRACE_MS
            : isPastHorizonNotFoundIndexingGrace(tip.expectedMaxTime!))
        ) {
          await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
            id: args.highlightTipId,
            reason: HORIZON_NOT_FOUND_TERMINAL_REASON,
            generation,
          })
          return
        }
        if (args.attempt < HORIZON_VERIFY_MAX_ATTEMPTS) {
          await ctx.scheduler.runAfter(
            verifyDelayMs(args.attempt),
            internal.stellarVerify.verifyHighlightTip,
            {
              highlightTipId: args.highlightTipId,
              attempt: args.attempt + 1,
              generation,
            }
          )
        } else {
          await ctx.runMutation(
            internal.stellarVerify.markHighlightTipTemporarilyUnavailable,
            { id: args.highlightTipId, generation }
          )
        }
        return
      }

      await ctx.runMutation(internal.stellarVerify.markHighlightTipFailed, {
        id: args.highlightTipId,
        reason: exactResult.reason,
        generation,
      })
      return
    }

    await ctx.runMutation(internal.stellarVerify.confirmVerifiedHighlightTip, {
      id: args.highlightTipId,
      stellarLedger: exactResult.ledger,
      generation,
    })
    return
  },
})

export const markHighlightTipTemporarilyUnavailable = internalMutation({
  args: {
    id: v.id('highlightTips'),
    generation: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip || tip.status !== 'PENDING' || !tip.highlightTipIntentId) return
    if (
      args.generation !== undefined &&
      (tip.verificationGeneration ?? 0) !== args.generation
    ) {
      return
    }
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
    generation: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip || tip.status !== 'PENDING') return
    if (
      args.generation !== undefined &&
      (tip.verificationGeneration ?? 0) !== args.generation
    ) {
      return
    }

    if (!tip.highlightTipIntentId) {
      const now = Date.now()
      await ctx.db.patch(args.id, {
        status: 'FAILED',
        failureReason: LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
        processedAt: now,
        updatedAt: now,
      })
      return
    }

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

    const normalizedTxId = normalizeStellarTransactionHash(
      tip.stellarTxId ?? ''
    )
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

    const [article, tipper, author] = await Promise.all([
      ctx.db.get(intent.articleId),
      ctx.db.get(intent.tipperId),
      ctx.db.get(intent.authorId),
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

    await creditAuthorEarnings(ctx, {
      authorId: intent.authorId,
      articleId: intent.articleId,
      articleTitle: intent.articleTitle,
      shareCents: writerShareCents(
        intent.amountCents,
        intent.expectedAmountStroops
      ),
      now,
    })

    const tipCount = (article.tipCount || 0) + 1
    await ctx.db.patch(intent.articleId, {
      tipCount,
      totalTipsUsd: (article.totalTipsUsd || 0) + intent.amountUsd,
      updatedAt: now,
    })
    await syncReadingRoomEngagement(ctx, intent.articleId, { tipCount })
    await ctx.db.patch(intent.tipperId, {
      tipsSentCount: (tipper.tipsSentCount || 0) + 1,
      updatedAt: now,
    })
    await ctx.db.patch(intent.authorId, {
      tipsReceivedCount: (author.tipsReceivedCount || 0) + 1,
      updatedAt: now,
    })
    await ctx.db.patch(args.id, {
      ...confirmedTipPatch(now),
      stellarLedger: args.stellarLedger,
      failureReason: undefined,
      amountUsdSuspicious: undefined,
      amountUsdSuspicionReason: undefined,
    })
  },
})

/**
 * Historical entrypoint retained only to terminalize a legacy PENDING row.
 * Already-CONFIRMED history remains untouched and readable.
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
    await ctx.db.patch(args.id, {
      status: 'FAILED',
      failureReason: LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
      processedAt: now,
      updatedAt: now,
    })
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
    generation: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.id)
    if (!tip) return
    if (tip.status !== 'PENDING') return
    if (
      args.generation !== undefined &&
      (tip.verificationGeneration ?? 0) !== args.generation
    ) {
      return
    }

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'FAILED',
      failureReason: args.reason,
      processedAt: now,
      updatedAt: now,
    })
  },
})
