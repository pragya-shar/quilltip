import { v } from 'convex/values'
import { internalAction, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { verifyTipTransaction } from './lib/horizon'
import { TIP_ARTICLE_FUNCTIONS, getTippingContractId } from './lib/constants'
import { resolveHorizonUrl, xlmStringToStroops } from './stellarVerify'

// 7-hour lookback with 1-hour overlap vs the 6-hour cron interval, so a
// tip skipped by one run for any reason still gets a second chance before
// drifting out of the window.
const RECONCILE_WINDOW_MS = 7 * 60 * 60 * 1000

// A highlight tip whose verification chain died (process crash, indexing
// delay beyond the retry budget) sits in PENDING forever otherwise. 10
// minutes is well past the longest legitimate verify window (initial 2s
// + 5s + 15s = 22s under the current schedule) so we won't race a healthy
// chain. Reconciliation runs every 6h, so a tip can sit stuck for at most
// one cycle before being re-kicked.
const STUCK_PENDING_THRESHOLD_MS = 10 * 60 * 1000

/**
 * Internal read used by the reconciliation action to hydrate recent
 * CONFIRMED article tips plus the author's Stellar address. Actions
 * cannot read the DB directly — they must go through a query.
 */
export const getRecentConfirmedArticleTipsForReconcile = internalQuery({
  args: { cutoffMs: v.number() },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_status_created', (q) =>
        q.eq('status', 'CONFIRMED').gt('createdAt', args.cutoffMs)
      )
      .collect()

    // Preload author stellar addresses so the action doesn't need to fan out
    // to a second query per tip. Order preserved.
    const authors = await Promise.all(
      tips.map((tip) => ctx.db.get(tip.authorId))
    )

    return tips.map((tip, i) => ({
      tip,
      authorStellarAddress: authors[i]?.stellarAddress ?? null,
    }))
  },
})

/**
 * Reconcile recent CONFIRMED article tips against the Stellar blockchain.
 * Runs every 6 hours via cron (see convex/crons.ts). For each tip:
 *   - Verifies the recorded stellarTxId matches our expected contract,
 *     function name, tipper, author, and min-stroops via Horizon.
 *   - Permanent mismatch → (if flag on) mark FRAUDULENT + reverse counters;
 *     (if flag off) log what would have happened (dry-run).
 *   - Transient error (network, 5xx, not_found) → leave alone; next tick retries.
 *   - ok → no action.
 *
 * The env var RECONCILE_TIPS_ENABLED gates the destructive path. Default
 * anything-other-than-'true' = dry-run, so the cron produces identical logs
 * minus the actual mutation. This lets us watch the output in production for
 * a few days and confirm the logic looks right before flipping to enforcement.
 *
 * PENDING tips are NOT scanned here. Stuck-PENDING recovery is I-series work.
 */
export const reconcileArticleTips = internalAction({
  args: {},
  handler: async (ctx) => {
    const destructiveEnabled = process.env.RECONCILE_TIPS_ENABLED === 'true'
    const cutoff = Date.now() - RECONCILE_WINDOW_MS

    // Hoisted env-read: fails loudly up-front rather than silently per tip.
    const contractId = getTippingContractId()

    const rows = await ctx.runQuery(
      internal.reconcileTips.getRecentConfirmedArticleTipsForReconcile,
      { cutoffMs: cutoff }
    )

    let checked = 0
    let ok = 0
    let flagged = 0
    let unreachable = 0
    let skipped = 0

    for (const { tip, authorStellarAddress } of rows) {
      checked++

      // Legacy placeholders (pre-C2'.1) or explicit empty sentinel — nothing
      // to verify against Horizon.
      if (!tip.stellarTxId || tip.stellarTxId.startsWith('pending_')) {
        skipped++
        continue
      }

      if (!tip.stellarSourceAccount || !tip.stellarAmountXlm) {
        skipped++
        continue
      }

      if (!authorStellarAddress) {
        skipped++
        continue
      }

      const minStroops = xlmStringToStroops(tip.stellarAmountXlm)
      if (minStroops === null || minStroops <= BigInt(0)) {
        skipped++
        continue
      }

      let result
      try {
        result = await verifyTipTransaction(fetch, {
          txId: tip.stellarTxId,
          expectedSource: tip.stellarSourceAccount,
          horizonUrl: resolveHorizonUrl(tip.stellarNetwork),
          invocation: {
            contractId,
            allowedFunctions: TIP_ARTICLE_FUNCTIONS,
            authorAddress: authorStellarAddress,
            minStroops,
          },
        })
      } catch (err) {
        // An unexpected throw (e.g., fetch polyfill missing in test env)
        // should not flag tips as fraudulent. Treat as transient and log.
        unreachable++
        console.warn(
          '[reconcileTips] unexpected verify error; treating as transient',
          {
            tipId: tip._id,
            error: err instanceof Error ? err.message : String(err),
          }
        )
        continue
      }

      if (result.ok) {
        ok++
        continue
      }

      if (result.kind === 'transient') {
        unreachable++
        console.warn('[reconcileTips] Horizon unreachable', {
          tipId: tip._id,
          reason: result.reason,
        })
        continue
      }

      // Permanent mismatch — this is the fraud signal.
      flagged++
      if (destructiveEnabled) {
        await ctx.runMutation(internal.tips.markArticleTipFraudulent, {
          tipId: tip._id,
          reason: result.reason,
        })
      } else {
        console.warn('[reconcileTips] DRY-RUN would mark FRAUDULENT', {
          tipId: tip._id,
          reason: result.reason,
        })
      }
    }

    const summary = {
      checked,
      ok,
      flagged,
      unreachable,
      skipped,
      dryRun: !destructiveEnabled,
    }
    console.log('[reconcileTips] summary', summary)
    return summary
  },
})

/**
 * Internal read for the stuck-PENDING highlight tip sweep. Returns ids of
 * highlightTips rows that are PENDING and older than STUCK_PENDING_THRESHOLD_MS,
 * which is well past any legitimate retry window. Indexed by status + createdAt
 * so the scan stays cheap as the table grows.
 */
export const getStuckPendingHighlightTipIds = internalQuery({
  args: { cutoffMs: v.number() },
  handler: async (ctx, args): Promise<Id<'highlightTips'>[]> => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_status_created', (q) =>
        q.eq('status', 'PENDING').lt('createdAt', args.cutoffMs)
      )
      .collect()
    return tips.map((tip) => tip._id)
  },
})

/**
 * Recover highlight tips whose verification chain died. For each PENDING
 * tip older than STUCK_PENDING_THRESHOLD_MS we reschedule verifyHighlightTip
 * with attempt=1, restarting the retry budget. The verify action's status
 * guard (`if (tip.status !== 'PENDING') return`) makes this safe even if the
 * original chain happens to be alive — at worst the tip sees one extra run
 * that no-ops on the already-flipped status.
 *
 * Not gated by RECONCILE_TIPS_ENABLED: rescheduling a verify is non-destructive
 * (it cannot mark a tip FRAUDULENT or move money), so dry-run vs enabled is
 * not meaningful here.
 */
export const recoverStuckPendingHighlightTips = internalAction({
  args: {},
  handler: async (ctx): Promise<{ rescheduled: number }> => {
    const cutoff = Date.now() - STUCK_PENDING_THRESHOLD_MS
    const ids: Id<'highlightTips'>[] = await ctx.runQuery(
      internal.reconcileTips.getStuckPendingHighlightTipIds,
      { cutoffMs: cutoff }
    )

    for (const id of ids) {
      await ctx.scheduler.runAfter(
        0,
        internal.stellarVerify.verifyHighlightTip,
        { highlightTipId: id, attempt: 1 }
      )
    }

    const summary = { rescheduled: ids.length }
    console.log('[reconcileTips] stuck-PENDING highlight sweep', summary)
    return summary
  },
})
