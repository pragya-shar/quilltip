/**
 * Internal entry points to the tip counts (`convex/lib/counts/sync.ts`): one
 * row or one receipt at a time, for a backfill and for operators. The money
 * layer calls `syncTipCounts` directly, inside its own mutations.
 */
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import {
  syncTipCounts,
  syncTipCountsForReceipt,
  type TipSource,
} from './lib/counts/sync'
import { tipSourceValidator } from './schema/counts'

const resultValidator = v.object({
  changed: v.boolean(),
  live: v.boolean(),
  cents: v.number(),
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
