/**
 * Backfill of the running money figures (`lib/chain/balanceFigures.ts`):
 * recounts every reader's reserved cents and every writer's figures from
 * their receipts (`lib/chain/balanceRecount.ts`), then rebuilds the
 * writer's collected bookkeeping from the settled totals. Each writer and
 * each reader is recounted in one mutation, so live traffic during the run
 * is safe, and running it again writes the same values.
 *
 *   npx convex run balanceBackfill:start
 *
 * It credits receipts settled before the figures existed and repairs a row
 * where an earlier, incremental backfill held collects as "ahead" of settled
 * money it had not credited.
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { recountReader, recountWriter } from './lib/chain/balanceRecount'

const PAGE = 50

export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.balanceBackfill.readers, {
      cursor: null,
    })
  },
})

/** One page of readers' accounts, then the next page, then the writers. */
export const readers = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const page = await ctx.db
      .query('tabAccounts')
      .paginate({ cursor: args.cursor, numItems: PAGE })
    for (const account of page.page) await recountReader(ctx, account, now)
    await ctx.scheduler.runAfter(
      0,
      page.isDone
        ? internal.balanceBackfill.writers
        : internal.balanceBackfill.readers,
      { cursor: page.isDone ? null : page.continueCursor }
    )
    return { readers: page.page.length, isDone: page.isDone }
  },
})

/** One page of users; each with receipts as a writer is recounted. */
export const writers = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const now = Date.now()
    const token = readChainEnv().tokenContractId ?? ''
    const page = await ctx.db
      .query('users')
      .paginate({ cursor: args.cursor, numItems: PAGE })
    let writers = 0
    for (const user of page.page)
      if (await recountWriter(ctx, user._id, token, now)) writers += 1
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.writers, {
        cursor: page.continueCursor,
      })
    return { writers, isDone: page.isDone }
  },
})
