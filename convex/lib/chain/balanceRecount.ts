/**
 * Recounts the running money figures (`balanceFigures.ts`) from receipts,
 * for the backfill (`convex/balanceBackfill.ts`). One writer or one reader
 * per call, read and written in one mutation, so a concurrent acceptance or
 * settlement either sees the recount or is retried after it.
 *
 * Writer: every bucket (pending, settled, on hold, not paid) is summed again
 * from the writer's receipts and written as an absolute value, and each
 * receipt's `moneyAppliedStatus` is set to its status. That credits receipts
 * settled before the figures existed (they were never credited), and running
 * it again writes the same values.
 *
 * Collected: rebuilt from the settled totals and the indexed
 * `collectedBaseUnits` at the average cost of everything settled
 * (`rebuiltCollected`), so an earlier collect is matched against settled
 * money instead of being held as "ahead" of it. Available plus collected
 * equals settled, exactly; a row whose collects were applied live may move
 * by a rounding step between the two, never in their sum.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { roundCents, tabShareCents } from '../authorEarnings'
import { bucketOf, earningsRow, reserves } from './balanceFigures'
import { receiptNet } from './tabLedger'

const ZERO = BigInt(0)
type TipRow = Doc<'tips'> | Doc<'highlightTips'>

async function centsOf(
  ctx: MutationCtx,
  receipt: Doc<'tabReceipts'>
): Promise<number> {
  return (
    receipt.amountCents ??
    ((await ctx.db.get(receipt.tipRowId)) as TipRow | null)?.amountCents ??
    0
  )
}

/**
 * Collected bookkeeping from totals: `collected` base units are matched
 * against `settledBase` first; what exceeds it is ahead of a settlement not
 * yet indexed. Cents move at the average cost of the settled cents.
 */
export function rebuiltCollected(
  settledCents: number,
  settledBase: bigint,
  collected: bigint
): { collectedCents: number; matched: bigint; ahead: bigint } {
  const matched = collected < settledBase ? collected : settledBase
  const collectedCents =
    settledBase <= ZERO || matched <= ZERO
      ? 0
      : matched === settledBase
        ? settledCents
        : roundCents((settledCents * Number(matched)) / Number(settledBase))
  return { collectedCents, matched, ahead: collected - matched }
}

/** Recounts one writer's figures from their receipts. */
export async function recountWriter(
  ctx: MutationCtx,
  userId: Id<'users'>,
  token: string,
  now: number
): Promise<boolean> {
  const receipts = await ctx.db
    .query('tabReceipts')
    .withIndex('by_author_accepted', (q) => q.eq('authorId', userId))
    .collect()
  if (receipts.length === 0) return false
  const cents = { pending: 0, onHold: 0, notPaid: 0, settled: 0 }
  const counts = { pending: 0, onHold: 0, notPaid: 0, settled: 0 }
  let settledBase = ZERO
  for (const r of receipts) {
    const net = receiptNet(r)
    const share = tabShareCents(await centsOf(ctx, r), net, BigInt(r.amount))
    const bucket = bucketOf(r.status)
    cents[bucket] = roundCents(cents[bucket] + share)
    counts[bucket] += 1
    if (bucket === 'settled') settledBase += net
    if (r.moneyAppliedStatus !== r.status)
      await ctx.db.patch(r._id, { moneyAppliedStatus: r.status })
  }
  const row = await earningsRow(ctx, userId, now)
  const collected = BigInt(row.collectedBaseUnits?.[token] ?? '0')
  const rebuilt = rebuiltCollected(cents.settled, settledBase, collected)
  await ctx.db.patch(row._id, {
    tabTipCount: counts.settled,
    tabEarnedCents: cents.settled,
    tabSettledBaseUnits: {
      ...row.tabSettledBaseUnits,
      [token]: settledBase.toString(),
    },
    tabPendingCents: cents.pending,
    tabPendingCount: counts.pending,
    tabOnHoldCents: cents.onHold,
    tabOnHoldCount: counts.onHold,
    tabNotPaidCents: cents.notPaid,
    tabNotPaidCount: counts.notPaid,
    tabCollectedCents: rebuilt.collectedCents,
    tabMatchedBaseUnits: {
      ...row.tabMatchedBaseUnits,
      [token]: rebuilt.matched.toString(),
    },
    tabAheadBaseUnits: {
      ...row.tabAheadBaseUnits,
      [token]: rebuilt.ahead.toString(),
    },
    tabCollectedAppliedBaseUnits: {
      ...row.tabCollectedAppliedBaseUnits,
      [token]: collected.toString(),
    },
    updatedAt: now,
  })
  return true
}

/** Recounts one reader's reserved cents from their receipts. */
export async function recountReader(
  ctx: MutationCtx,
  account: Doc<'tabAccounts'>,
  now: number
): Promise<void> {
  const receipts = await ctx.db
    .query('tabReceipts')
    .withIndex('by_account_accepted', (q) => q.eq('tabAccountId', account._id))
    .collect()
  let reserved = 0
  for (const r of receipts)
    if (reserves(r.status)) reserved += await centsOf(ctx, r)
  if (account.reservedCents !== reserved)
    await ctx.db.patch(account._id, { reservedCents: reserved, updatedAt: now })
}
