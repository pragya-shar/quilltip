/**
 * Backfill of the running money figures (`lib/chain/balanceFigures.ts`):
 * recounts every reader's reserved cents and every writer's figures from
 * their receipts (`lib/chain/balanceRecount.ts`), then rebuilds the
 * writer's collected bookkeeping from the settled totals. One reader's
 * account or one writer per scheduled mutation, and at most `RECOUNT_PAGE`
 * receipts read in one: a reader or writer with more is recounted a page of
 * receipts per mutation. Live traffic during the run is safe, and running
 * it again writes the same values.
 *
 *   npx convex run balanceBackfill:start
 *
 * It credits receipts settled before the figures existed and repairs a row
 * where an earlier, incremental backfill held collects as "ahead" of settled
 * money it had not credited.
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import {
  rebuildCollected,
  recountReader,
  recountWriter,
  resyncReaderPage,
  resyncWriterPage,
} from './lib/chain/balanceRecount'

const cursor = v.union(v.string(), v.null())
/** Where the outer walk resumes: its cursor, or null once it is done. */
const next = v.object({ cursor, done: v.boolean() })
type Next = { cursor: string | null; done: boolean }

const token = () => readChainEnv().tokenContractId ?? ''

export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.balanceBackfill.readers, {
      cursor: null,
    })
  },
})

async function afterReader(ctx: MutationCtx, after: Next) {
  await ctx.scheduler.runAfter(
    0,
    after.done
      ? internal.balanceBackfill.writers
      : internal.balanceBackfill.readers,
    { cursor: after.done ? null : after.cursor }
  )
}

async function afterWriter(ctx: MutationCtx, after: Next) {
  if (!after.done)
    await ctx.scheduler.runAfter(0, internal.balanceBackfill.writers, {
      cursor: after.cursor,
    })
}

/** One reader's account, then the next; then the writers. */
export const readers = internalMutation({
  args: { cursor },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('tabAccounts')
      .paginate({ cursor: args.cursor, numItems: 1 })
    const after = { cursor: page.continueCursor, done: page.isDone }
    const account = page.page[0]
    if (account && (await recountReader(ctx, account, Date.now())) === 'paged')
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.readerPages, {
        accountId: account._id,
        receipts: null,
        after,
      })
    else await afterReader(ctx, after)
    return { account: account?._id ?? null, isDone: page.isDone }
  },
})

/** One page of a reader's receipts, for a reader with many. */
export const readerPages = internalMutation({
  args: { accountId: v.id('tabAccounts'), receipts: cursor, after: next },
  handler: async (ctx, args) => {
    const page = await resyncReaderPage(
      ctx,
      args.accountId as Id<'tabAccounts'>,
      args.receipts,
      Date.now()
    )
    if (page.isDone) await afterReader(ctx, args.after)
    else
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.readerPages, {
        ...args,
        receipts: page.cursor,
      })
  },
})

/** One user; with receipts as a writer, recounted. Then the next. */
export const writers = internalMutation({
  args: { cursor },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('users')
      .paginate({ cursor: args.cursor, numItems: 1 })
    const after = { cursor: page.continueCursor, done: page.isDone }
    const user = page.page[0]
    const outcome = user
      ? await recountWriter(ctx, user._id, token(), Date.now())
      : 'none'
    if (user && outcome === 'paged')
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.writerPages, {
        userId: user._id,
        receipts: null,
        after,
      })
    else await afterWriter(ctx, after)
    return { writer: outcome === 'none' ? null : user!._id, outcome }
  },
})

/** One page of a writer's receipts, for a writer with many; then collected. */
export const writerPages = internalMutation({
  args: { userId: v.id('users'), receipts: cursor, after: next },
  handler: async (ctx, args) => {
    const now = Date.now()
    const page = await resyncWriterPage(ctx, args.userId, args.receipts, now)
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.balanceBackfill.writerPages, {
        ...args,
        receipts: page.cursor,
      })
      return
    }
    await rebuildCollected(ctx, args.userId, token(), now)
    await afterWriter(ctx, args.after)
  },
})
