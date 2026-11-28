/**
 * Entry points to the tip counts (`convex/lib/counts/sync.ts`): the public
 * article figures, the daily snapshot that publishes them, and internal
 * syncs of one row or one receipt and the backfill, for operators. The money
 * layer calls `syncTipCounts` directly, inside its own mutations.
 *
 * Public reads read only the snapshot tables, which change once a day. A
 * tip therefore never changes anything a public read returns at the moment
 * it is made, so no reader can learn from a count who tipped or when.
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalMutation, query, type MutationCtx } from './_generated/server'
import {
  syncTipCounts,
  syncTipCountsForReceipt,
  type TipSource,
} from './lib/counts/sync'
import { getAuthUserId } from '@convex-dev/auth/server'
import { MIN_LINE_TIPS, labelOf } from './passages'
import { tipSourceValidator } from './schema/counts'

/**
 * Tip rows one backfill step syncs. A highlight tip counted for the first
 * time reads its article's text, so a step can read this many articles.
 */
export const BACKFILL_BATCH = 8

/** Running figures one snapshot step copies. */
export const SNAPSHOT_BATCH = 50

/** The UTC day of a time, `YYYY-MM-DD`. */
export function utcDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

const resultValidator = v.object({
  changed: v.boolean(),
  live: v.boolean(),
  cents: v.number(),
})

/**
 * A published article's tip figures as of the last daily snapshot: gross
 * cents as sent, tips, and readers with the copy `label` (see
 * `convex/passages.ts`). Null for an unpublished or missing article; zeros
 * before its first counted tip appears in a snapshot.
 */
export const article = query({
  args: { articleId: v.id('articles') },
  returns: v.union(
    v.null(),
    v.object({
      tipCount: v.number(),
      tipCents: v.number(),
      readerCount: v.number(),
      unidentifiedTipCount: v.number(),
      label: v.union(v.literal('tips'), v.literal('readers')),
    })
  ),
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article || article.published !== true) return null
    const stats = await ctx.db
      .query('articleTipSnapshots')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .unique()
    const f = {
      tipCount: stats?.tipCount ?? 0,
      tipCents: stats?.tipCents ?? 0,
      distinctTippers: stats?.distinctTippers ?? 0,
      unidentifiedTipCount: stats?.unidentifiedTipCount ?? 0,
    }
    return {
      tipCount: f.tipCount,
      tipCents: f.tipCents,
      readerCount: f.distinctTippers,
      unidentifiedTipCount: f.unidentifiedTipCount,
      label: labelOf(f),
    }
  },
})

export const syncRow = internalMutation({
  args: { source: tipSourceValidator, rowId: v.string() },
  returns: v.union(v.null(), resultValidator),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId(args.source, args.rowId)
    if (!id) return null
    return syncTipCounts(ctx, args.source as TipSource, id)
  },
})

export const syncReceipt = internalMutation({
  args: { receiptId: v.id('tabReceipts') },
  returns: v.union(v.null(), resultValidator),
  handler: async (ctx, args) => syncTipCountsForReceipt(ctx, args.receiptId),
})

/**
 * Counts every existing tip row: `tips`, then `highlightTips`, a page of
 * `BACKFILL_BATCH` rows per step, rescheduling itself until both are done.
 * Each row is synced exactly as its next status change would sync it, so
 * rows already counted are left as they are: a second run, or a run beside
 * live tips, changes nothing. A finished run does nothing until `restart`.
 */
export const backfill = internalMutation({
  args: { restart: v.optional(v.boolean()) },
  returns: v.object({
    source: tipSourceValidator,
    rows: v.number(),
    changed: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now()
    let state = await ctx.db
      .query('countsBackfills')
      .withIndex('by_key', (q) => q.eq('key', 'counts'))
      .unique()
    if (!state || args.restart) {
      const fresh = {
        key: 'counts' as const,
        source: 'tips' as const,
        cursor: null,
        rows: 0,
        changed: 0,
        startedAt: now,
        updatedAt: now,
      }
      if (state) await ctx.db.replace(state._id, fresh)
      else await ctx.db.insert('countsBackfills', fresh)
      state = (await ctx.db
        .query('countsBackfills')
        .withIndex('by_key', (q) => q.eq('key', 'counts'))
        .unique())!
    }
    if (state.finishedAt !== undefined) {
      return {
        source: state.source,
        rows: state.rows,
        changed: state.changed,
        done: true,
      }
    }
    const source = state.source as TipSource
    const read = (cursor: string | null) =>
      ctx.db.query(source).paginate({ numItems: BACKFILL_BATCH, cursor })
    // A position saved before a schema or index change may no longer be a
    // valid cursor: this table's pass starts again (safe: rows are idempotent).
    const page = await read(state.cursor).catch(() => read(null))
    let changed = 0
    for (const row of page.page) {
      const result = await syncTipCounts(ctx, source, row._id, now)
      if (result.changed) changed++
    }
    const next = !page.isDone
      ? { source, cursor: page.continueCursor }
      : source === 'tips'
        ? { source: 'highlightTips' as const, cursor: null }
        : null
    await ctx.db.patch(state._id, {
      ...(next ?? { cursor: null, finishedAt: now }),
      rows: state.rows + page.page.length,
      changed: state.changed + changed,
      updatedAt: now,
    })
    if (next) await ctx.scheduler.runAfter(0, internal.counts.backfill, {})
    return {
      source,
      rows: state.rows + page.page.length,
      changed: state.changed + changed,
      done: next === null,
    }
  },
})

type SnapshotFigures = Pick<
  Doc<'articleTipSnapshots'>,
  'tipCount' | 'tipCents' | 'distinctTippers' | 'unidentifiedTipCount'
>

function sameFigures(a: SnapshotFigures, b: SnapshotFigures): boolean {
  return (
    a.tipCount === b.tipCount &&
    a.tipCents === b.tipCents &&
    a.distinctTippers === b.distinctTippers &&
    a.unidentifiedTipCount === b.unidentifiedTipCount
  )
}

function figuresOfStats(stats: SnapshotFigures): SnapshotFigures {
  return {
    tipCount: stats.tipCount,
    tipCents: stats.tipCents,
    distinctTippers: stats.distinctTippers,
    unidentifiedTipCount: stats.unidentifiedTipCount,
  }
}

/** Copies one article's running figures to its public copy; true if changed. */
async function snapshotArticle(
  ctx: MutationCtx,
  stats: Doc<'articleTipStats'>,
  day: string
): Promise<boolean> {
  const copy = await ctx.db
    .query('articleTipSnapshots')
    .withIndex('by_article', (q) => q.eq('articleId', stats.articleId))
    .unique()
  const figures = figuresOfStats(stats)
  if (copy ? sameFigures(copy, figures) : figures.tipCount === 0) return false
  if (copy) await ctx.db.patch(copy._id, { ...figures, day })
  else
    await ctx.db.insert('articleTipSnapshots', {
      articleId: stats.articleId,
      ...figures,
      day,
    })
  return true
}

/** Copies one passage's running figures to its public copy; true if changed. */
async function snapshotPassage(
  ctx: MutationCtx,
  stats: Doc<'passageStats'>,
  day: string
): Promise<boolean> {
  const copy = await ctx.db
    .query('passageTipSnapshots')
    .withIndex('by_article_passage', (q) =>
      q.eq('articleId', stats.articleId).eq('passageId', stats.passageId)
    )
    .unique()
  const figures = figuresOfStats(stats)
  if (copy ? sameFigures(copy, figures) : figures.tipCount === 0) return false
  if (copy) await ctx.db.patch(copy._id, { ...figures, day })
  else
    await ctx.db.insert('passageTipSnapshots', {
      articleId: stats.articleId,
      passageId: stats.passageId,
      authorId: stats.authorId,
      ...figures,
      quote: stats.quote,
      day,
    })
  return true
}

/** Copies one (sharer, line) count to the sharer's copy; true if changed. */
async function snapshotShareLine(
  ctx: MutationCtx,
  stats: Doc<'shareLineStats'>,
  day: string
): Promise<boolean> {
  const copy = await ctx.db
    .query('shareLineSnapshots')
    .withIndex('by_sharer_line', (q) =>
      q
        .eq('sharerId', stats.sharerId)
        .eq('articleId', stats.articleId)
        .eq('passageId', stats.passageId)
    )
    .unique()
  if (copy ? copy.tipCount === stats.tipCount : stats.tipCount === 0)
    return false
  if (copy) await ctx.db.patch(copy._id, { tipCount: stats.tipCount, day })
  else
    await ctx.db.insert('shareLineSnapshots', {
      sharerId: stats.sharerId,
      articleId: stats.articleId,
      passageId: stats.passageId,
      tipCount: stats.tipCount,
      day,
    })
  return true
}

/** Shared lines one `mySharedLines` read returns at most. */
export const MAX_SHARED_LINES = 50

/**
 * The caller's shared lines that brought tips back, as of the last daily
 * snapshot: `{ articleId, passageId, tipCount }`, the most first, only from
 * `MIN_LINE_TIPS` tips. A count only: no amounts, no times, nobody named.
 * Signed out: none.
 */
export const mySharedLines = query({
  args: {},
  returns: v.array(
    v.object({
      articleId: v.id('articles'),
      passageId: v.string(),
      tipCount: v.number(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('shareLineSnapshots')
      .withIndex('by_sharer_tipCount', (q) =>
        q.eq('sharerId', userId).gte('tipCount', MIN_LINE_TIPS)
      )
      .order('desc')
      .take(MAX_SHARED_LINES)
    return rows.map((row) => ({
      articleId: row.articleId,
      passageId: row.passageId,
      tipCount: row.tipCount,
    }))
  },
})

/**
 * The daily cron: starts today's snapshot unless one is running or today's
 * is done. The run then continues in `snapshotStep`.
 */
export const startSnapshot = internalMutation({
  args: {},
  returns: v.union(
    v.literal('started'),
    v.literal('running'),
    v.literal('done')
  ),
  handler: async (ctx) => {
    const now = Date.now()
    const day = utcDayOf(now)
    const run = await ctx.db
      .query('countsSnapshotRuns')
      .withIndex('by_key', (q) => q.eq('key', 'daily'))
      .unique()
    if (run && run.finishedAt === undefined) return 'running'
    if (run && run.day === day) return 'done'
    const fresh = {
      key: 'daily' as const,
      day,
      phase: 'articles' as const,
      cursor: null,
      rows: 0,
      changed: 0,
      startedAt: now,
      updatedAt: now,
    }
    if (run) await ctx.db.replace(run._id, fresh)
    else await ctx.db.insert('countsSnapshotRuns', fresh)
    await ctx.scheduler.runAfter(0, internal.counts.snapshotStep, {})
    return 'started'
  },
})

/**
 * One page of the running snapshot: copies up to `SNAPSHOT_BATCH` running
 * figures that differ from their public copies, then schedules the next
 * page. Every public copy of a run carries the run's day. Safe to repeat: a
 * copied figure is equal on the next pass and is not written again.
 */
export const snapshotStep = internalMutation({
  args: {},
  returns: v.object({
    phase: v.union(
      v.literal('articles'),
      v.literal('passages'),
      v.literal('shares')
    ),
    rows: v.number(),
    changed: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now()
    const run = await ctx.db
      .query('countsSnapshotRuns')
      .withIndex('by_key', (q) => q.eq('key', 'daily'))
      .unique()
    if (!run || run.finishedAt !== undefined) {
      return {
        phase: run?.phase ?? 'articles',
        rows: run?.rows ?? 0,
        changed: run?.changed ?? 0,
        done: true,
      }
    }
    const opts = (cursor: string | null) => ({
      numItems: SNAPSHOT_BATCH,
      cursor,
    })
    let changed = 0
    let isDone: boolean
    let continueCursor: string
    let read: number
    if (run.phase === 'articles') {
      const page = await ctx.db
        .query('articleTipStats')
        .paginate(opts(run.cursor))
        .catch(() => ctx.db.query('articleTipStats').paginate(opts(null)))
      for (const stats of page.page)
        if (await snapshotArticle(ctx, stats, run.day)) changed++
      ;({ isDone, continueCursor } = page)
      read = page.page.length
    } else if (run.phase === 'passages') {
      const page = await ctx.db
        .query('passageStats')
        .paginate(opts(run.cursor))
        .catch(() => ctx.db.query('passageStats').paginate(opts(null)))
      for (const stats of page.page)
        if (await snapshotPassage(ctx, stats, run.day)) changed++
      ;({ isDone, continueCursor } = page)
      read = page.page.length
    } else {
      const page = await ctx.db
        .query('shareLineStats')
        .paginate(opts(run.cursor))
        .catch(() => ctx.db.query('shareLineStats').paginate(opts(null)))
      for (const stats of page.page)
        if (await snapshotShareLine(ctx, stats, run.day)) changed++
      ;({ isDone, continueCursor } = page)
      read = page.page.length
    }
    const next = !isDone
      ? { phase: run.phase, cursor: continueCursor }
      : run.phase === 'articles'
        ? { phase: 'passages' as const, cursor: null }
        : run.phase === 'passages'
          ? { phase: 'shares' as const, cursor: null }
          : null
    await ctx.db.patch(run._id, {
      ...(next ?? { cursor: null, finishedAt: now }),
      rows: run.rows + read,
      changed: run.changed + changed,
      updatedAt: now,
    })
    if (next) await ctx.scheduler.runAfter(0, internal.counts.snapshotStep, {})
    return {
      phase: run.phase,
      rows: run.rows + read,
      changed: run.changed + changed,
      done: next === null,
    }
  },
})
