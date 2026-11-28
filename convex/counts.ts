/**
 * Entry points to the tip counts (`convex/lib/counts/sync.ts`): the public
 * article figures, and internal syncs of one row or one receipt and the
 * backfill, for operators. The money layer calls `syncTipCounts` directly,
 * inside its own mutations.
 */
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, query } from './_generated/server'
import {
  syncTipCounts,
  syncTipCountsForReceipt,
  type TipSource,
} from './lib/counts/sync'
import { labelOf } from './passages'
import { tipSourceValidator } from './schema/counts'

/** Tip rows one backfill step syncs. */
export const BACKFILL_BATCH = 25

const resultValidator = v.object({
  changed: v.boolean(),
  live: v.boolean(),
  cents: v.number(),
})

/**
 * A published article's tip figures: gross cents as sent, tips, and readers
 * with the copy `label` (see `convex/passages.ts`). Null for an unpublished
 * or missing article; zeros before its first counted tip.
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
      .query('articleTipStats')
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
