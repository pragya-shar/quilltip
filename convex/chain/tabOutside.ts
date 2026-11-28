/**
 * Tab activity not accepted here (#647): reads and the acknowledgement of
 * `tabOutsideEvents` rows. The Tab handlers write the rows
 * (`convex/lib/chain/tabOutside.ts`). What to do is in
 * docs/operations/chain-runbook.md, "Tab activity not accepted here".
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from '../_generated/server'
import { opsUserIds } from './indexer'

/** Open rows read for the page and the command line, oldest first. */
export const OUTSIDE_SAMPLE = 100

function view(row: Doc<'tabOutsideEvents'>) {
  return {
    chainEpoch: row.chainEpoch,
    eventId: row.eventId,
    kind: row.kind,
    tabAccountId: (row.tabAccountId ?? null) as string | null,
    keyId: row.keyId,
    gross: row.gross ?? null,
    cumulative: row.cumulative ?? null,
    acceptedCumulative: row.acceptedCumulative ?? null,
    byWriter: row.byWriter ?? null,
    ledger: row.ledger,
    txHash: row.txHash,
    createdAt: row.createdAt,
  }
}

async function openRows(ctx: QueryCtx, limit: number) {
  const rows = await ctx.db
    .query('tabOutsideEvents')
    .withIndex('by_open', (q) => q.eq('acknowledgedAt', undefined))
    .order('asc')
    .take(limit + 1)
  return {
    rows: rows.slice(0, limit).map(view),
    more: rows.length > limit,
  }
}

/** Open records for `app/ops/chain`. Null unless the user is in `OPS_USER_IDS`. */
export const getOutsideTabActivity = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId || !opsUserIds().has(userId)) return null
    return { ...(await openRows(ctx, OUTSIDE_SAMPLE)), limit: OUTSIDE_SAMPLE }
  },
})

/** The same open records, for the command line. */
export const listOpen = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    openRows(ctx, Math.min(Math.max(1, args.limit ?? OUTSIDE_SAMPLE), 500)),
})

/**
 * Closes a record after the runbook checks. The row stays; a second call
 * changes nothing.
 */
export const acknowledge = internalMutation({
  args: { chainEpoch: v.string(), eventId: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const note = args.note.trim().slice(0, 500)
    if (!note) {
      throw new ConvexError({
        code: 'NOTE_REQUIRED',
        message: 'Record why the record is closed.',
      })
    }
    const row = await ctx.db
      .query('tabOutsideEvents')
      .withIndex('by_epoch_event', (q) =>
        q.eq('chainEpoch', args.chainEpoch).eq('eventId', args.eventId)
      )
      .first()
    if (!row) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'No record for this epoch and event ID.',
      })
    }
    if (row.acknowledgedAt !== undefined) {
      return { acknowledgedAt: row.acknowledgedAt, changed: false }
    }
    const now = Date.now()
    await ctx.db.patch(row._id, { acknowledgedAt: now, acknowledgedNote: note })
    return { acknowledgedAt: now, changed: true }
  },
})
