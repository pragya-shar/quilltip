/**
 * Settler freshness for `app/ops/chain` (#647): the age of the last settler
 * run that did not fail, read outside the settler, so a settler that stops
 * running shows here although it logs nothing. The run records its end on the
 * `settler` lease row (`recordSettlerRun`). What to do is in
 * docs/operations/chain-runbook.md, "Settler not running".
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { internalQuery, query, type QueryCtx } from '../_generated/server'
import {
  SETTLER_STALE_ALERT_MS,
  SETTLER_STALE_WARN_MS,
  settlerFreshness,
} from '../lib/chain/settler'
import { opsUserIds } from './indexer'

async function freshness(ctx: QueryCtx) {
  const lease = await ctx.db
    .query('chainLeases')
    .withIndex('by_name', (q) => q.eq('name', 'settler'))
    .unique()
  return {
    ...settlerFreshness(lease?.lastOkAt, Date.now()),
    // The cron does nothing while settlement is off; the age still grows.
    settlementEnabled: process.env.SETTLEMENT_ENABLED?.trim() === 'true',
    warnMs: SETTLER_STALE_WARN_MS,
    alertMs: SETTLER_STALE_ALERT_MS,
  }
}

/** Null unless the user is in `OPS_USER_IDS`. */
export const getSettlerFreshness = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId || !opsUserIds().has(userId)) return null
    return freshness(ctx)
  },
})

/** The same, for the command line. */
export const readSettlerFreshness = internalQuery({
  args: {},
  handler: async (ctx) => freshness(ctx),
})
