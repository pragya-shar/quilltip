/**
 * Backfill of the running money figures (`lib/chain/balanceFigures.ts`) for
 * receipts and collects indexed before the figures existed. Idempotent:
 * each receipt moves its money only from `moneyAppliedStatus` to its status,
 * and collected cents follow only the part of `collectedBaseUnits` not yet
 * applied, so running it again, or alongside live traffic, changes nothing.
 *
 *   npx convex run balanceBackfill:start
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { syncCollectedCents } from './lib/chain/balanceFigures'
import { readChainEnv } from './lib/chain/env'
import { syncReceiptMoneyFor } from './lib/chain/tabLedger'

const PAGE = 200

export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.balanceBackfill.receipts, {
      cursor: null,
    })
  },
})

/** One page of receipts, then the next page, then the collects. */
export const receipts = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const page = await ctx.db
      .query('tabReceipts')
      .paginate({ cursor: args.cursor, numItems: PAGE })
    for (const receipt of page.page)
      await syncReceiptMoneyFor(ctx, receipt._id, now)
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.receipts, {
        cursor: page.continueCursor,
      })
    } else {
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.collected, {
        cursor: null,
      })
    }
    return { synced: page.page.length, isDone: page.isDone }
  },
})

/** One page of writers' collected amounts, then the next. */
export const collected = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const token = readChainEnv().tokenContractId
    const page = await ctx.db
      .query('authorEarnings')
      .paginate({ cursor: args.cursor, numItems: PAGE })
    if (token)
      for (const row of page.page)
        await syncCollectedCents(ctx, row.userId, token, now)
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.collected, {
        cursor: page.continueCursor,
      })
    }
    return { synced: page.page.length, isDone: page.isDone }
  },
})
