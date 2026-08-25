import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { verifyTipTransaction } from './lib/horizon'
import {
  LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
  TIP_ARTICLE_FUNCTIONS,
  getTippingContractId,
} from './lib/constants'
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
const EXPIRED_INTENT_CLEANUP_LIMIT = 100

export const getExpiredUnlinkedArticleTipIntentIds = internalQuery({
  args: { nowMs: v.number() },
  returns: v.array(v.id('articleTipIntents')),
  handler: async (ctx, args): Promise<Id<'articleTipIntents'>[]> => {
    const intents = await ctx.db
      .query('articleTipIntents')
      .withIndex('by_tip_expiry', (q) =>
        q.eq('tipId', undefined).lt('expiresAt', args.nowMs)
      )
      .take(EXPIRED_INTENT_CLEANUP_LIMIT)
    return intents.map((intent) => intent._id)
  },
})

export const getExpiredUnlinkedHighlightTipIntentIds = internalQuery({
  args: { nowMs: v.number() },
  returns: v.array(v.id('highlightTipIntents')),
  handler: async (ctx, args): Promise<Id<'highlightTipIntents'>[]> => {
    const intents = await ctx.db
      .query('highlightTipIntents')
      .withIndex('by_tip_expiry', (q) =>
        q.eq('tipId', undefined).lt('expiresAt', args.nowMs)
      )
      .take(EXPIRED_INTENT_CLEANUP_LIMIT)
    return intents.map((intent) => intent._id)
  },
})

export const deleteExpiredUnlinkedArticleTipIntents = internalMutation({
  args: {
    intentIds: v.array(v.id('articleTipIntents')),
    nowMs: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let deleted = 0
    for (const intentId of args.intentIds) {
      const intent = await ctx.db.get(intentId)
      if (!intent || intent.tipId || intent.expiresAt >= args.nowMs) continue
      await ctx.db.delete(intentId)
      deleted++
    }
    return deleted
  },
})

export const deleteExpiredUnlinkedHighlightTipIntents = internalMutation({
  args: {
    intentIds: v.array(v.id('highlightTipIntents')),
    nowMs: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let deleted = 0
    for (const intentId of args.intentIds) {
      const intent = await ctx.db.get(intentId)
      if (!intent || intent.tipId || intent.expiresAt >= args.nowMs) continue
      await ctx.db.delete(intentId)
      deleted++
    }
    return deleted
  },
})

/**
 * Drain expired pre-wallet intent rows in bounded batches. Linked intents are
 * immutable audit records and are checked again in the delete mutation to
 * protect a concurrent submission between the query and mutation.
 */
export const cleanupExpiredTipIntents = internalAction({
  args: {},
  returns: v.object({
    articleIntentsDeleted: v.number(),
    highlightIntentsDeleted: v.number(),
  }),
  handler: async (
    ctx
  ): Promise<{
    articleIntentsDeleted: number
    highlightIntentsDeleted: number
  }> => {
    const nowMs = Date.now()
    const [articleIntentIds, highlightIntentIds]: [
      Id<'articleTipIntents'>[],
      Id<'highlightTipIntents'>[],
    ] = await Promise.all([
      ctx.runQuery(
        internal.reconcileTips.getExpiredUnlinkedArticleTipIntentIds,
        {
          nowMs,
        }
      ),
      ctx.runQuery(
        internal.reconcileTips.getExpiredUnlinkedHighlightTipIntentIds,
        { nowMs }
      ),
    ])
    const [articleIntentsDeleted, highlightIntentsDeleted] = await Promise.all([
      ctx.runMutation(
        internal.reconcileTips.deleteExpiredUnlinkedArticleTipIntents,
        { intentIds: articleIntentIds, nowMs }
      ),
      ctx.runMutation(
        internal.reconcileTips.deleteExpiredUnlinkedHighlightTipIntents,
        { intentIds: highlightIntentIds, nowMs }
      ),
    ])
    const summary = { articleIntentsDeleted, highlightIntentsDeleted }
    console.log('[reconcileTips] expired intent cleanup', summary)
    return summary
  },
})

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
 * PENDING tips are handled by a separate, non-destructive recovery action below.
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

      // Intent-backed rows with verifiedAt already passed the stricter exact
      // verifier using immutable source, recipient, article, amount, network,
      // and contract expectations. Rechecking them against today's author
      // wallet or deployment contract could falsely reverse a valid payment.
      if (tip.articleTipIntentId && tip.verifiedAt) {
        skipped++
        continue
      }

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
 * intent-backed highlightTips rows whose verification activity is older than
 * STUCK_PENDING_THRESHOLD_MS, well past any legitimate retry window.
 * Indexed by status + updatedAt so a claimed batch can advance fairly.
 */
export const getStuckPendingHighlightTipIds = internalQuery({
  args: { cutoffMs: v.number() },
  handler: async (ctx, args): Promise<Id<'highlightTips'>[]> => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'PENDING').lt('updatedAt', args.cutoffMs)
      )
      .filter((q) => q.neq(q.field('highlightTipIntentId'), undefined))
      .take(100)
    return tips.map((tip) => tip._id)
  },
})

export const claimStuckPendingHighlightTips = internalMutation({
  args: { cutoffMs: v.number(), nowMs: v.number() },
  returns: v.array(
    v.object({
      tipId: v.id('highlightTips'),
      generation: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'PENDING').lt('updatedAt', args.cutoffMs)
      )
      .filter((q) => q.neq(q.field('highlightTipIntentId'), undefined))
      .take(100)

    for (const tip of tips) {
      await ctx.db.patch(tip._id, { updatedAt: args.nowMs })
    }
    return tips.map((tip) => ({
      tipId: tip._id,
      generation: tip.verificationGeneration ?? 0,
    }))
  },
})

export const quarantineLegacyPendingHighlightTips = internalMutation({
  args: { cutoffMs: v.number() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_status_created', (q) =>
        q.eq('status', 'PENDING').lt('createdAt', args.cutoffMs)
      )
      .filter((q) => q.eq(q.field('highlightTipIntentId'), undefined))
      .take(100)
    const now = Date.now()
    for (const tip of tips) {
      await ctx.db.patch(tip._id, {
        status: 'FAILED',
        failureReason: LEGACY_PENDING_HIGHLIGHT_TIP_QUARANTINE_REASON,
        processedAt: now,
        updatedAt: now,
      })
    }
    return tips.length
  },
})

/**
 * Recover intent-backed highlight tips whose verification chain died. Legacy
 * PENDING rows never cross the post-cutover trust boundary: they are
 * terminalized without verification or counters. Each old intent-backed row
 * is rescheduled with attempt=1, restarting the retry budget. The verify
 * action's status guard makes this safe even if the original chain is alive.
 *
 * Not gated by RECONCILE_TIPS_ENABLED: rescheduling a verify is non-destructive
 * (it cannot mark a tip FRAUDULENT or move money), so dry-run vs enabled is
 * not meaningful here.
 */
export const recoverStuckPendingHighlightTips = internalAction({
  args: {},
  returns: v.object({ rescheduled: v.number(), quarantined: v.number() }),
  handler: async (
    ctx
  ): Promise<{ rescheduled: number; quarantined: number }> => {
    const now = Date.now()
    const cutoff = now - STUCK_PENDING_THRESHOLD_MS
    const quarantined = await ctx.runMutation(
      internal.reconcileTips.quarantineLegacyPendingHighlightTips,
      { cutoffMs: cutoff }
    )
    const claims: Array<{
      tipId: Id<'highlightTips'>
      generation: number
    }> = await ctx.runMutation(
      internal.reconcileTips.claimStuckPendingHighlightTips,
      { cutoffMs: cutoff, nowMs: now }
    )

    for (const claim of claims) {
      await ctx.scheduler.runAfter(
        0,
        internal.stellarVerify.verifyHighlightTip,
        {
          highlightTipId: claim.tipId,
          attempt: 1,
          generation: claim.generation,
        }
      )
    }

    const summary = { rescheduled: claims.length, quarantined }
    console.log('[reconcileTips] stuck-PENDING highlight sweep', summary)
    return summary
  },
})

/**
 * Find article tips whose normal verification retry chain appears to have
 * stopped. The bounded take prevents one recovery tick from growing without
 * limit; later ticks continue draining any backlog.
 */
export const getStuckPendingArticleTipIds = internalQuery({
  args: { cutoffMs: v.number() },
  returns: v.array(v.id('tips')),
  handler: async (ctx, args): Promise<Id<'tips'>[]> => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'PENDING').lt('updatedAt', args.cutoffMs)
      )
      .filter((q) => q.neq(q.field('articleTipIntentId'), undefined))
      .take(100)

    return tips.map((tip) => tip._id)
  },
})

/**
 * Restart verification for whole-article tips that remained PENDING after the
 * reader left or a scheduled action was interrupted. The verifier is
 * idempotent and only credits a still-PENDING tip after rechecking Stellar.
 */
export const recoverStuckPendingArticleTips = internalAction({
  args: {},
  returns: v.object({ rescheduled: v.number() }),
  handler: async (ctx): Promise<{ rescheduled: number }> => {
    const cutoff = Date.now() - STUCK_PENDING_THRESHOLD_MS
    const ids: Id<'tips'>[] = await ctx.runQuery(
      internal.reconcileTips.getStuckPendingArticleTipIds,
      { cutoffMs: cutoff }
    )

    for (const tipId of ids) {
      await ctx.scheduler.runAfter(
        0,
        internal.articleTipVerify.verifyArticleTip,
        { tipId, attempt: 1 }
      )
    }

    const summary = { rescheduled: ids.length }
    console.log('[reconcileTips] stuck-PENDING article sweep', summary)
    return summary
  },
})
