import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server'
import {
  addLifetimeTotals,
  addUnits,
  emptyLifetimeTotals,
  subtractUnits,
  tipRowTotals,
  type LifetimeRebuild,
} from './lib/lifetimeEarnings'

// Rebuilds the lifetime totals of `authorEarnings` rows from their history
// (#552, convex/lib/lifetimeEarnings.ts). It writes only `authorEarnings`.
//
// A row without `lifetimeTotalsAt` is rebuilt in steps. Each step is one
// mutation that reads one page and stores its progress on the row
// (`lifetimeRebuild`): the user's `tips`, then `highlightTips` (`by_author`),
// then the tab pairs (`tabVouchers.by_writer`) of every writer address on
// their tab rows and their current address. An interrupted run resumes from
// the stored cursor. Credits made meanwhile go into the rebuild's sums when
// it has already read the row or pair they change (`creditTipRowTotals`,
// `notePairEarned`), so a busy writer never restarts.
//
// The last step writes the v1 and tab totals, and the wallet part of
// `earnedBaseUnits` (`walletEarnedBaseUnits`: `earnedBaseUnits` less the
// `earnedNet` of the user's tab pairs), then sets `lifetimeTotalsAt`.
//
// The cron runs it every minute. A run advances the rows that waited longest
// (`lifetimeRebuildTurnAt`) by a bounded number of steps each, so a long
// history never holds up the rows behind it. Rebuilt rows are skipped: a run
// with nothing left reads one index entry and writes nothing.

const PAGE_SIZE = 200
const ROWS_PER_RUN = 20
const STEPS_PER_ROW = 10

export const pendingRows = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.id('authorEarnings')),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query('authorEarnings')
      .withIndex('by_lifetime_totals', (q) =>
        q.eq('lifetimeTotalsAt', undefined)
      )
      .take(limit)
    return rows.map((row) => row._id)
  },
})

async function startRebuild(
  ctx: MutationCtx,
  row: Doc<'authorEarnings'>,
  now: number
): Promise<LifetimeRebuild> {
  const user = await ctx.db.get(row.userId)
  return {
    phase: 'tips',
    cursor: null,
    lastCreationTime: null,
    writers: user?.stellarAddress ? [user.stellarAddress] : [],
    writerIndex: 0,
    totals: emptyLifetimeTotals(),
    pairNet: {},
    unlistedPairNet: {},
    startedAt: now,
    steps: 0,
  }
}

/** Reads one page of the row's history; `done` once the totals are written. */
export const rebuildStep = internalMutation({
  args: { id: v.id('authorEarnings') },
  returns: v.union(v.literal('more'), v.literal('done')),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return 'done'
    if (row.lifetimeTotalsAt !== undefined && !row.lifetimeRebuild) {
      return 'done'
    }
    const now = Date.now()
    let r = row.lifetimeRebuild ?? (await startRebuild(ctx, row, now))
    r = { ...r, steps: r.steps + 1 }

    if (r.phase === 'tips' || r.phase === 'highlightTips') {
      const page = await ctx.db
        .query(r.phase)
        .withIndex('by_author', (q) => q.eq('authorId', row.userId))
        .paginate({ cursor: r.cursor, numItems: PAGE_SIZE })
      let totals = r.totals
      const writers = [...r.writers]
      const unlisted = { ...r.unlistedPairNet }
      for (const tip of page.page) {
        const delta = tipRowTotals(tip)
        if (delta) totals = addLifetimeTotals(totals, delta)
        const address = tip.channel === 'tab' ? tip.expectedAuthorAddress : null
        if (address && !writers.includes(address)) {
          // Its pairs are read whole later, with every change so far.
          writers.push(address)
          delete unlisted[address]
        }
      }
      const last = page.page.at(-1)?._creationTime ?? r.lastCreationTime
      r = page.isDone
        ? {
            ...r,
            totals,
            writers,
            unlistedPairNet: unlisted,
            phase: r.phase === 'tips' ? 'highlightTips' : 'pairs',
            cursor: null,
            lastCreationTime: null,
          }
        : {
            ...r,
            totals,
            writers,
            unlistedPairNet: unlisted,
            cursor: page.continueCursor,
            lastCreationTime: last,
          }
    } else if (r.writerIndex < r.writers.length) {
      const page = await ctx.db
        .query('tabVouchers')
        .withIndex('by_writer', (q) =>
          q.eq('writerAddress', r.writers[r.writerIndex]!)
        )
        .paginate({ cursor: r.cursor, numItems: PAGE_SIZE })
      let pairNet = r.pairNet
      for (const pair of page.page) {
        if (pair.authorId === row.userId) {
          pairNet = addUnits(pairNet, {
            [pair.tokenContractId]: pair.earnedNet,
          })
        }
      }
      const last = page.page.at(-1)?._creationTime ?? r.lastCreationTime
      r = page.isDone
        ? {
            ...r,
            pairNet,
            writerIndex: r.writerIndex + 1,
            cursor: null,
            lastCreationTime: null,
          }
        : { ...r, pairNet, cursor: page.continueCursor, lastCreationTime: last }
    }

    if (r.phase === 'pairs' && r.writerIndex >= r.writers.length) {
      let tabPairs = r.pairNet
      for (const units of Object.values(r.unlistedPairNet)) {
        tabPairs = addUnits(tabPairs, units)
      }
      await ctx.db.patch(id, {
        ...r.totals,
        walletEarnedBaseUnits: subtractUnits(
          row.earnedBaseUnits ?? {},
          tabPairs
        ),
        lifetimeTotalsAt: now,
        lifetimeRebuild: undefined,
        lifetimeRebuildTurnAt: undefined,
      })
      return 'done'
    }
    await ctx.db.patch(id, { lifetimeRebuild: r, lifetimeRebuildTurnAt: now })
    return 'more'
  },
})

export const run = internalAction({
  args: {},
  returns: v.object({ rebuilt: v.number(), inProgress: v.number() }),
  handler: async (ctx) => {
    const ids = await ctx.runQuery(
      internal.earningsTotalsBackfill.pendingRows,
      { limit: ROWS_PER_RUN }
    )
    let rebuilt = 0
    let inProgress = 0
    for (const id of ids) {
      let result: 'more' | 'done' = 'more'
      for (let step = 0; step < STEPS_PER_ROW && result === 'more'; step++) {
        result = await ctx.runMutation(
          internal.earningsTotalsBackfill.rebuildStep,
          { id }
        )
      }
      if (result === 'done') rebuilt += 1
      else inProgress += 1
    }
    return { rebuilt, inProgress }
  },
})
