/**
 * Recounts the running money figures (`balanceFigures.ts`) from receipts,
 * for the backfill (`convex/balanceBackfill.ts`). One writer or one reader
 * per call, read and written in one mutation, so a concurrent acceptance or
 * settlement either sees the recount or is retried after it.
 *
 * Writer: pending (the whole share of each accepted tip), on hold and not
 * paid (the share less what was paid) are summed again from the writer's
 * receipts and written as absolute values, and each receipt's applied
 * status and cents are set. Settled figures are the lifetime totals'
 * (`tabTipCount`, `tabEarnedCents`, `tabSettledBaseUnits`, #552), which
 * their own rebuild (`earningsTotalsBackfill`) fills; this file only reads
 * them. Run this after that rebuild. Running either again is safe: this
 * recount writes the same values from the same receipts and totals.
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
import { tabSettledOf } from '../lifetimeEarnings'
import { bucketOf, earningsRow, reserves, unpaidCents } from './balanceFigures'
import { paidPartOf, receiptNet, tabVoucher } from './tabLedger'

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

/** The pair's paid amount for a receipt, read once per pair. */
function pairPaid(ctx: MutationCtx) {
  const cache = new Map<string, bigint>()
  return async (r: Doc<'tabReceipts'>) => {
    const key = `${r.tabAccountId}:${r.keyId}:${r.writerAddress}`
    if (!cache.has(key)) {
      const pair = await tabVoucher(
        ctx,
        r.tabAccountId,
        r.keyId,
        r.writerAddress
      )
      cache.set(key, BigInt(pair?.paidOnChain ?? '0'))
    }
    return cache.get(key)!
  }
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
  const paidOf = pairPaid(ctx)
  const cents = { pending: 0, onHold: 0, notPaid: 0 }
  const counts = { pending: 0, onHold: 0, notPaid: 0 }
  for (const r of receipts) {
    const amount = BigInt(r.amount)
    const amountCents = await centsOf(ctx, r)
    const paid = paidPartOf(r, await paidOf(r))
    const share = tabShareCents(amountCents, receiptNet(r), amount)
    const bucket = bucketOf(r.status)
    const held =
      bucket === 'settled'
        ? 0
        : bucket === 'pending'
          ? share
          : Math.max(
              0,
              roundCents(share - tabShareCents(amountCents, paid.net, amount))
            )
    if (bucket !== 'settled') {
      cents[bucket] = roundCents(cents[bucket] + held)
      counts[bucket] += 1
    }
    const reserved = reserves(r.status)
      ? unpaidCents(amountCents, amount, paid.gross)
      : 0
    if (
      r.moneyAppliedStatus !== r.status ||
      r.moneyAppliedCents !== held ||
      r.moneyReservedCents !== reserved
    )
      await ctx.db.patch(r._id, {
        moneyAppliedStatus: r.status,
        moneyAppliedCents: held,
        moneyReservedCents: reserved,
      })
  }
  const row = await earningsRow(ctx, userId, now)
  // Settled figures are the lifetime totals'; read, never written here.
  const settled = tabSettledOf(row, token)
  const settledCents = settled.cents
  const settledBase = settled.baseUnits
  const collected = BigInt(row.collectedBaseUnits?.[token] ?? '0')
  const rebuilt = rebuiltCollected(settledCents, settledBase, collected)
  await ctx.db.patch(row._id, {
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

/** Recounts one reader's reserved cents (unpaid parts) from their receipts. */
export async function recountReader(
  ctx: MutationCtx,
  account: Doc<'tabAccounts'>,
  now: number
): Promise<void> {
  const receipts = await ctx.db
    .query('tabReceipts')
    .withIndex('by_account_accepted', (q) => q.eq('tabAccountId', account._id))
    .collect()
  const paidOf = pairPaid(ctx)
  let reserved = 0
  for (const r of receipts)
    if (reserves(r.status))
      reserved = roundCents(
        reserved +
          unpaidCents(
            await centsOf(ctx, r),
            BigInt(r.amount),
            paidPartOf(r, await paidOf(r)).gross
          )
      )
  if (account.reservedCents !== reserved)
    await ctx.db.patch(account._id, { reservedCents: reserved, updatedAt: now })
}
