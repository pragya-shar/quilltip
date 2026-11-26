import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { syncV2TipEarningsBatch } from './lib/v2Earnings'

/**
 * Credits v2 direct and batch tips that became `CONFIRMED` or `MISMATCH` to
 * `authorEarnings` (docs/architecture/v2/06-app-integration.md, section 6.2).
 * Runs from a cron and reschedules itself while full pages remain. Each row
 * is credited once (`earningsAppliedAt`).
 */
export const syncV2TipEarnings = internalMutation({
  args: {},
  returns: v.object({ credited: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const result = await syncV2TipEarningsBatch(ctx, Date.now())
    if (result.more) {
      await ctx.scheduler.runAfter(
        0,
        internal.tipEarnings.syncV2TipEarnings,
        {}
      )
    }
    return result
  },
})
