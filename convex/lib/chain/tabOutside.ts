/**
 * Tab events this deployment did not originate (#647;
 * docs/operations/chain-runbook.md, "Tab activity not accepted here").
 *
 * The Tab handlers call `recordOutsideEvent` when they meet:
 *
 * - `settled_no_account`: a `TabSettled` for a reader with no account in the
 *   event's epoch;
 * - `settled_no_voucher`: a `TabSettled` for an account of this site, with no
 *   voucher for the key and writer;
 * - `settled_above_accepted`: a `TabSettled` above the cumulative amount this
 *   deployment accepted for the pair;
 * - `key_undeclared`: a new `KeyRegistered` for an account of this site that
 *   the app did not declare (`pendingKeys`).
 *
 * Each settlement needs an acceptor signature or the settler role, so none of
 * these occurs while one deployment uses the contract and holds its keys.
 * The record changes no figure, and the handler's result stays as it was.
 *
 * One row per (`chainEpoch`, `eventId`), kept for good: the log line is
 * written only by the mutation that inserts the row, so a replay, a
 * re-dispatch, a backfill or rebuilt `chainEvents` rows raise nothing new.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { IndexedEvent } from './indexerStore'
import type { TabOutsideKind } from './schema'

export const TAB_OUTSIDE_LOG_CODE = 'CHAIN_TAB_OUTSIDE_EVENT'

export type OutsideEventFields = {
  kind: TabOutsideKind
  tabAccountId?: Id<'tabAccounts'>
  keyId: number
  gross?: bigint
  cumulative?: bigint
  acceptedCumulative?: bigint
  byWriter?: boolean
}

/** Records the event once. Returns whether this call inserted the row. */
export async function recordOutsideEvent(
  ctx: MutationCtx,
  event: IndexedEvent,
  fields: OutsideEventFields
): Promise<boolean> {
  const doc = event.doc
  const existing = await ctx.db
    .query('tabOutsideEvents')
    .withIndex('by_epoch_event', (q) =>
      q.eq('chainEpoch', doc.chainEpoch).eq('eventId', doc.eventId)
    )
    .first()
  if (existing) return false
  const row: Omit<Doc<'tabOutsideEvents'>, '_id' | '_creationTime'> = {
    network: doc.network,
    chainEpoch: doc.chainEpoch,
    eventId: doc.eventId,
    kind: fields.kind,
    tabAccountId: fields.tabAccountId,
    keyId: fields.keyId,
    gross: fields.gross?.toString(),
    cumulative: fields.cumulative?.toString(),
    acceptedCumulative: fields.acceptedCumulative?.toString(),
    byWriter: fields.byWriter,
    ledger: doc.ledger,
    txHash: doc.txHash,
    createdAt: event.now,
  }
  await ctx.db.insert('tabOutsideEvents', row)
  // No address: the account id and the transaction identify the reader.
  console.error(
    JSON.stringify({
      code: TAB_OUTSIDE_LOG_CODE,
      kind: row.kind,
      tabAccountId: row.tabAccountId ? String(row.tabAccountId) : null,
      keyId: row.keyId,
      gross: row.gross ?? null,
      ...(row.kind === 'settled_above_accepted'
        ? {
            cumulative: row.cumulative,
            acceptedCumulative: row.acceptedCumulative,
          }
        : {}),
      ledger: row.ledger,
      eventId: row.eventId,
      chainEpoch: row.chainEpoch,
      byWriter: row.byWriter ?? null,
      txHash: row.txHash,
    })
  )
  return true
}
