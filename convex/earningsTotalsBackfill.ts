import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  type DatabaseReader,
} from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { receiptPaidNet, tabVoucher } from './lib/chain/tabLedger'
import {
  addLifetimeTotals,
  addUnits,
  changedLifetimeFields,
  clearedLifetimeTotals,
  emptyLifetimeTotals,
  lifetimeFigures,
  previousFigures,
  readLifetimeTotals,
  tabPaidTotals,
  tipRowTotals,
  totalsFromHistory,
  type LifetimeRebuild,
  type LifetimeTotals,
} from './lib/lifetimeEarnings'
import {
  lifetimeRebuildValidator,
  lifetimeTotalsValidator,
} from './lib/lifetimeTotalsFields'
import type { TipRow } from './lib/tipReads'

// Rebuilds the lifetime totals of `authorEarnings` rows from their history
// (#552, convex/lib/lifetimeEarnings.ts). It writes only `authorEarnings`.
//
// Operator switch: `EARNINGS_TOTALS_REBUILD_ENABLED=true`. The cron runs every
// minute; while the switch is off a run reads nothing and writes nothing, and
// a row in progress keeps its saved position until it is on again.
//
// A row without `lifetimeTotalsAt` is rebuilt in steps. Each step is one
// mutation that reads one page and stores its progress on the row
// (`lifetimeRebuild`): the user's `tips`, then `highlightTips` (`by_author`),
// then the tab pairs (`tabVouchers.by_writer`) of every writer address on
// their tab rows and their current address. A v1 row counts by `tipRowTotals`;
// a tab row by the net its receipt has been paid on chain (`receiptPaidNet`
// against its pair's `paidOnChain`). An interrupted run resumes from the
// stored position. A credit made meanwhile also goes into the rebuild's sums
// when the rebuild has already read the row or pair it changes
// (`creditV1TipTotals`, `reverseV1TipTotals`, `creditTabTipTotals`,
// `notePairEarned`); a row or pair not read yet is read later with the change.
//
// The last step writes the v1 and tab totals, and the wallet part of
// `earnedBaseUnits` (`walletEarnedBaseUnits`: `earnedBaseUnits` less the
// `earnedNet` of the user's tab pairs), then sets `lifetimeTotalsAt`.
//
// A run advances the rows that waited longest (`lifetimeRebuildTurnAt`), 20
// rows by up to 10 steps each, so a long history never holds up the rows
// behind it. A step that fails records `lifetimeRebuildError` on the row and
// the run goes on; the next run tries again.
//
// Operator functions: `dryRun` (what a rebuild would write, per writer, no
// writes), `progress`, and `reset` (`restart`: rebuild every row again;
// `remove`: unset every lifetime field, the shape before #552).

const PAGE_SIZE = 200
const ROWS_PER_RUN = 20
const STEPS_PER_ROW = 10
const RESET_PAGE_SIZE = 100
const PROGRESS_LIMIT = 10_000

export function rebuildEnabled(): boolean {
  return process.env.EARNINGS_TOTALS_REBUILD_ENABLED === 'true'
}

function xlmToken(): string | null {
  try {
    return readChainEnv().tokenContractId
  } catch {
    return null
  }
}

/** A tab tip's totals: the net its receipt has been paid on chain. */
async function tabRowTotals(
  db: DatabaseReader,
  row: TipRow
): Promise<Partial<LifetimeTotals> | null> {
  if (row.channel !== 'tab' || !row.clientRef) return null
  const receipt = await db
    .query('tabReceipts')
    .withIndex('by_client_ref', (q) => q.eq('clientRef', row.clientRef!))
    .first()
  if (!receipt) return null
  const pair = await tabVoucher(
    { db } as Parameters<typeof tabVoucher>[0],
    receipt.tabAccountId,
    receipt.keyId,
    receipt.writerAddress
  )
  if (!pair) return null
  return tabPaidTotals(
    receiptPaidNet(receipt, BigInt(pair.paidOnChain)),
    row.amountCents,
    BigInt(receipt.amount),
    pair.tokenContractId
  )
}

async function startRebuild(
  db: DatabaseReader,
  row: Doc<'authorEarnings'>,
  now: number
): Promise<LifetimeRebuild> {
  const user = await db.get(row.userId)
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

/** One page of a row's rebuild, without writing; `totals` once it is done. */
async function advance(
  db: DatabaseReader,
  row: Doc<'authorEarnings'>,
  from: LifetimeRebuild
): Promise<{ state: LifetimeRebuild; totals: LifetimeTotals | null }> {
  let r: LifetimeRebuild = { ...from, steps: from.steps + 1 }
  if (r.phase === 'tips' || r.phase === 'highlightTips') {
    const page = await db
      .query(r.phase)
      .withIndex('by_author', (q) => q.eq('authorId', row.userId))
      .paginate({ cursor: r.cursor, numItems: PAGE_SIZE })
    let totals = r.totals
    const writers = [...r.writers]
    const unlisted = { ...r.unlistedPairNet }
    for (const tip of page.page as TipRow[]) {
      const v1 = tipRowTotals(tip)
      if (v1) totals = addLifetimeTotals(totals, v1)
      const tab = await tabRowTotals(db, tip)
      if (tab) totals = addLifetimeTotals(totals, tab)
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
    const page = await db
      .query('tabVouchers')
      .withIndex('by_writer', (q) =>
        q.eq('writerAddress', r.writers[r.writerIndex]!)
      )
      .paginate({ cursor: r.cursor, numItems: PAGE_SIZE })
    let pairNet = r.pairNet
    for (const pair of page.page) {
      if (pair.authorId === row.userId) {
        pairNet = addUnits(pairNet, { [pair.tokenContractId]: pair.earnedNet })
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
  if (r.phase !== 'pairs' || r.writerIndex < r.writers.length) {
    return { state: r, totals: null }
  }
  let tabPairs = r.pairNet
  for (const units of Object.values(r.unlistedPairNet)) {
    tabPairs = addUnits(tabPairs, units)
  }
  return {
    state: r,
    totals: totalsFromHistory(r.totals, tabPairs, row.earnedBaseUnits),
  }
}

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
    const from = row.lifetimeRebuild ?? (await startRebuild(ctx.db, row, now))
    const { state, totals } = await advance(ctx.db, row, from)
    if (totals) {
      await ctx.db.patch(id, {
        ...totals,
        lifetimeTotalsAt: now,
        lifetimeRebuild: undefined,
        lifetimeRebuildTurnAt: undefined,
        lifetimeRebuildError: undefined,
      })
      return 'done'
    }
    await ctx.db.patch(id, {
      lifetimeRebuild: state,
      lifetimeRebuildTurnAt: now,
    })
    return 'more'
  },
})

export const recordError = internalMutation({
  args: { id: v.id('authorEarnings'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, error }) => {
    if (!(await ctx.db.get(id))) return null
    await ctx.db.patch(id, {
      lifetimeRebuildError: error.slice(0, 500),
      lifetimeRebuildTurnAt: Date.now(),
    })
    return null
  },
})

export const run = internalAction({
  args: {},
  returns: v.object({
    status: v.union(v.literal('disabled'), v.literal('ran')),
    rebuilt: v.number(),
    inProgress: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx) => {
    if (!rebuildEnabled()) {
      return {
        status: 'disabled' as const,
        rebuilt: 0,
        inProgress: 0,
        failed: 0,
      }
    }
    const ids: Id<'authorEarnings'>[] = await ctx.runQuery(
      internal.earningsTotalsBackfill.pendingRows,
      { limit: ROWS_PER_RUN }
    )
    let rebuilt = 0
    let inProgress = 0
    let failed = 0
    for (const id of ids) {
      try {
        let result: 'more' | 'done' = 'more'
        for (let step = 0; step < STEPS_PER_ROW && result === 'more'; step++) {
          result = (await ctx.runMutation(
            internal.earningsTotalsBackfill.rebuildStep,
            { id }
          )) as 'more' | 'done'
        }
        if (result === 'done') rebuilt += 1
        else inProgress += 1
      } catch (error) {
        failed += 1
        await ctx.runMutation(internal.earningsTotalsBackfill.recordError, {
          id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { status: 'ran' as const, rebuilt, inProgress, failed }
  },
})

const figuresValidator = v.object({
  tipCount: v.number(),
  earnedStroops: v.string(),
  estimatedUsd: v.number(),
})

function shown(f: { stroops: bigint; cents: number; tipCount: number }) {
  return {
    tipCount: f.tipCount,
    earnedStroops: f.stroops.toString(),
    estimatedUsd: Math.round(f.cents * 10_000) / 1_000_000,
  }
}

/** A page of rows for `dryRun`, with what the summary shows for each now. */
export const dryRunRows = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  returns: v.object({
    rows: v.array(
      v.object({
        id: v.id('authorEarnings'),
        userId: v.id('users'),
        source: v.union(v.literal('lifetime'), v.literal('previous')),
        shown: figuresValidator,
      })
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db
      .query('authorEarnings')
      .paginate({ cursor, numItems: Math.min(Math.max(limit, 1), 50) })
    const token = xlmToken()
    const rows = []
    for (const row of page.page) {
      const lifetime =
        row.lifetimeTotalsAt !== undefined && !row.lifetimeRebuild
      const figures = lifetime
        ? lifetimeFigures(readLifetimeTotals(row), row, token)
        : await previousFigures(ctx.db, row.userId, row, token)
      rows.push({
        id: row._id,
        userId: row.userId,
        source: lifetime ? ('lifetime' as const) : ('previous' as const),
        shown: shown(figures),
      })
    }
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone }
  },
})

/** One step of a rebuild held in memory, for `dryRun`; it writes nothing. */
export const previewStep = internalQuery({
  args: {
    id: v.id('authorEarnings'),
    state: v.union(v.null(), lifetimeRebuildValidator),
  },
  returns: v.object({
    state: v.union(v.null(), lifetimeRebuildValidator),
    totals: v.union(v.null(), lifetimeTotalsValidator),
    stored: v.union(v.null(), lifetimeTotalsValidator),
  }),
  handler: async (ctx, { id, state }) => {
    const row = await ctx.db.get(id)
    if (!row) return { state: null, totals: null, stored: null }
    const from = state ?? (await startRebuild(ctx.db, row, Date.now()))
    const next = await advance(ctx.db, row, from)
    return {
      state: next.state,
      totals: next.totals,
      stored: next.totals ? readLifetimeTotals(row) : null,
    }
  },
})

/**
 * What a rebuild would write, without writing: for each row of a page, the
 * figures the summary shows now, the figures after a rebuild, and the stored
 * totals that would change. Continue with `continueCursor` until `isDone`.
 */
export const dryRun = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(
      v.object({
        userId: v.id('users'),
        source: v.union(v.literal('lifetime'), v.literal('previous')),
        shown: figuresValidator,
        rebuilt: figuresValidator,
        changedFields: v.array(v.string()),
        steps: v.number(),
      })
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, limit }) => {
    const page: {
      rows: {
        id: Id<'authorEarnings'>
        userId: Id<'users'>
        source: 'lifetime' | 'previous'
        shown: { tipCount: number; earnedStroops: string; estimatedUsd: number }
      }[]
      continueCursor: string
      isDone: boolean
    } = await ctx.runQuery(internal.earningsTotalsBackfill.dryRunRows, {
      cursor: cursor ?? null,
      limit: limit ?? 20,
    })
    const token = xlmToken()
    const rows: {
      userId: Id<'users'>
      source: 'lifetime' | 'previous'
      shown: { tipCount: number; earnedStroops: string; estimatedUsd: number }
      rebuilt: { tipCount: number; earnedStroops: string; estimatedUsd: number }
      changedFields: string[]
      steps: number
    }[] = []
    for (const row of page.rows) {
      let state: LifetimeRebuild | null = null
      let steps = 0
      for (;;) {
        const next: {
          state: LifetimeRebuild | null
          totals: LifetimeTotals | null
          stored: LifetimeTotals | null
        } = await ctx.runQuery(internal.earningsTotalsBackfill.previewStep, {
          id: row.id,
          state,
        })
        steps += 1
        if (!next.state) break
        if (next.totals && next.stored) {
          const wallet: { v2EarnedCents: number; v2TipCount: number } =
            await ctx.runQuery(internal.earningsTotalsBackfill.walletFigures, {
              id: row.id,
            })
          rows.push({
            userId: row.userId,
            source: row.source,
            shown: row.shown,
            rebuilt: shown(lifetimeFigures(next.totals, wallet, token)),
            changedFields: changedLifetimeFields(next.stored, next.totals),
            steps,
          })
          break
        }
        state = next.state
      }
    }
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone }
  },
})

export const walletFigures = internalQuery({
  args: { id: v.id('authorEarnings') },
  returns: v.object({ v2EarnedCents: v.number(), v2TipCount: v.number() }),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    return {
      v2EarnedCents: row?.v2EarnedCents ?? 0,
      v2TipCount: row?.v2TipCount ?? 0,
    }
  },
})

/**
 * The rebuild's progress: the operator's check is `waiting` 0, `inProgress`
 * empty and `errors` empty (every row has `lifetimeTotalsAt`).
 */
export const progress = internalQuery({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    total: v.number(),
    rebuilt: v.number(),
    waiting: v.number(),
    inProgress: v.array(
      v.object({
        userId: v.id('users'),
        phase: v.string(),
        steps: v.number(),
        writerIndex: v.number(),
        writers: v.number(),
        turnAt: v.union(v.number(), v.null()),
      })
    ),
    errors: v.array(v.object({ userId: v.id('users'), error: v.string() })),
    lastRunAt: v.union(v.number(), v.null()),
    complete: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query('authorEarnings').take(PROGRESS_LIMIT + 1)
    let rebuilt = 0
    let waiting = 0
    let lastRunAt: number | null = null
    const inProgress = []
    const errors = []
    for (const row of rows.slice(0, PROGRESS_LIMIT)) {
      const at = row.lifetimeRebuildTurnAt ?? row.lifetimeTotalsAt
      if (at !== undefined && (lastRunAt === null || at > lastRunAt)) {
        lastRunAt = at
      }
      if (row.lifetimeRebuildError) {
        errors.push({ userId: row.userId, error: row.lifetimeRebuildError })
      }
      if (row.lifetimeRebuild) {
        inProgress.push({
          userId: row.userId,
          phase: row.lifetimeRebuild.phase,
          steps: row.lifetimeRebuild.steps,
          writerIndex: row.lifetimeRebuild.writerIndex,
          writers: row.lifetimeRebuild.writers.length,
          turnAt: row.lifetimeRebuildTurnAt ?? null,
        })
      } else if (row.lifetimeTotalsAt !== undefined) {
        rebuilt += 1
      } else {
        waiting += 1
      }
    }
    return {
      enabled: rebuildEnabled(),
      total: Math.min(rows.length, PROGRESS_LIMIT),
      rebuilt,
      waiting,
      inProgress,
      errors,
      lastRunAt,
      complete: rows.length <= PROGRESS_LIMIT,
    }
  },
})

const resetMode = v.union(v.literal('restart'), v.literal('remove'))

export const resetPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), mode: resetMode },
  returns: v.object({
    reset: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, mode }) => {
    const page = await ctx.db
      .query('authorEarnings')
      .paginate({ cursor, numItems: RESET_PAGE_SIZE })
    for (const row of page.page) {
      await ctx.db.patch(row._id, {
        ...(mode === 'remove' ? clearedLifetimeTotals() : {}),
        lifetimeTotalsAt: undefined,
        lifetimeRebuild: undefined,
        lifetimeRebuildTurnAt: undefined,
        lifetimeRebuildError: undefined,
      })
    }
    return {
      reset: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

/**
 * `restart`: every row is rebuilt again from its history (the summary shows
 * the previous figures for a row until then). `remove`: also unsets every
 * lifetime total, so rows have the shape they had before #552 (for a
 * rollback of the functions).
 */
export const reset = internalAction({
  args: { mode: resetMode },
  returns: v.object({ reset: v.number() }),
  handler: async (ctx, { mode }) => {
    let cursor: string | null = null
    let total = 0
    for (;;) {
      const page: { reset: number; continueCursor: string; isDone: boolean } =
        await ctx.runMutation(internal.earningsTotalsBackfill.resetPage, {
          cursor,
          mode,
        })
      total += page.reset
      if (page.isDone) return { reset: total }
      cursor = page.continueCursor
    }
  },
})
