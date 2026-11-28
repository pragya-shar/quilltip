/**
 * Running money figures for tab (balance) tips, so every total the screens
 * show is exact at any history length (no capped scan of receipts):
 *
 * - Reader: `tabAccounts.reservedCents`, the tip-time cents of the receipts
 *   that still reserve the balance (`ACCEPTED`, `SHORTFALL`). The base-unit
 *   twin is `tabAccounts.outstanding`.
 * - Writer (`authorEarnings`): the settled tips are the lifetime totals'
 *   `tabTipCount`, `tabEarnedCents` and `tabSettledBaseUnits`, written by
 *   the lifetime totals (`creditTabTipTotals`, once per paid range of a
 *   pair, #552). This file adds what they do not keep: `tabPendingCents`
 *   (`ACCEPTED`), `tabOnHoldCents` (`SHORTFALL`), `tabNotPaidCents`
 *   (`UNPAID`, `REJECTED`, `VOID_RESET`), each with a count, and
 *   `tabCollectedCents`.
 *
 * `syncReceiptMoney` is the only writer of the receipt buckets. It moves a
 * receipt's money from `moneyAppliedStatus` to its current `status` and
 * records the new applied status in the same mutation, so it is idempotent,
 * runs once per transition, and also backfills receipts accepted before the
 * figures existed. Acceptance and `setReceiptStatus` call it.
 *
 * Collected cents. A collect is in base units (the indexed `Claimed`
 * amount); tips carry cents at their own price. Rule: average cost. A
 * collect of `b` base units when `A` base units and `C` cents are available
 * moves `round(C * b / A)` cents (on the 1/10,000-cent grid) to collected,
 * and all of `C` when `b` empties `A`, where available is settled
 * (`tabEarnedCents`, `tabSettledBaseUnits`) minus collected. Collected cents
 * are only ever moved from settled cents, so `available + collected =
 * settled` holds exactly after any sequence of collects, with no drift. A
 * collect seen before the settlement that funded it (out-of-order indexing)
 * is held as "ahead" and matched against the next settled receipts.
 * `syncCollectedCents` applies the difference between the indexed
 * `collectedBaseUnits` and the part already applied, so a replayed event
 * changes nothing.
 *
 * Cents are on the 1/10,000-cent grid of `roundCents`, like
 * `totalEarnedCents`, and screens show them exactly. One token per row for
 * now: cents are not split by token.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import {
  newRowTotalsFields,
  roundCents,
  tabShareCents,
} from '../authorEarnings'
import { tabSettledOf } from '../lifetimeEarnings'
import { BPS_DENOMINATOR, FEE_BPS } from './fees'
import type { TabReceiptStatus } from './schema'

const ZERO = BigInt(0)

export type Bucket = 'pending' | 'settled' | 'onHold' | 'notPaid'

export function bucketOf(status: TabReceiptStatus): Bucket {
  switch (status) {
    case 'ACCEPTED':
      return 'pending'
    case 'SETTLED':
      return 'settled'
    case 'SHORTFALL':
      return 'onHold'
    case 'UNPAID':
    case 'REJECTED':
    case 'VOID_RESET':
      return 'notPaid'
  }
}

/** Settled figures belong to the lifetime totals; these are the others. */
export const CENTS_FIELD = {
  pending: 'tabPendingCents',
  onHold: 'tabOnHoldCents',
  notPaid: 'tabNotPaidCents',
} as const
export const COUNT_FIELD = {
  pending: 'tabPendingCount',
  onHold: 'tabOnHoldCount',
  notPaid: 'tabNotPaidCount',
} as const

/** True while the receipt's value is reserved against the reader's balance. */
export function reserves(status: TabReceiptStatus | null | undefined): boolean {
  return status === 'ACCEPTED' || status === 'SHORTFALL'
}

function getBig(record: Record<string, string> | undefined, token: string) {
  return record?.[token] ? BigInt(record[token]) : ZERO
}
function setBig(
  record: Record<string, string> | undefined,
  token: string,
  value: bigint
): Record<string, string> {
  return { ...record, [token]: value.toString() }
}

/** The writer's `authorEarnings` row, created empty when missing. */
export async function earningsRow(
  ctx: MutationCtx,
  userId: Id<'users'>,
  now: number
): Promise<Doc<'authorEarnings'>> {
  const row = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  if (row) return row
  const id = await ctx.db.insert('authorEarnings', {
    userId,
    ...(await newRowTotalsFields(ctx, userId, now)),
    totalEarnedUsd: 0,
    totalEarnedCents: 0,
    availableBalanceUsd: 0,
    availableBalanceCents: 0,
    pendingBalanceUsd: 0,
    pendingBalanceCents: 0,
    withdrawnUsd: 0,
    withdrawnCents: 0,
    tipCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  return (await ctx.db.get(id))!
}

/** What of a receipt is paid on chain, from its pair's `paidOnChain`. */
export type PaidPart = {
  /** Base units of this receipt covered by the pair's paid amount. */
  gross: bigint
  /** The writer's net of that part (`receiptPaidNet`). */
  net: bigint
}

/**
 * The reader's cents a receipt holds in the account's reserve now, as the
 * last move recorded it. A receipt with no `moneyReservedCents` marker was
 * never moved by code that records one, and every path that moves a
 * reserve records it (acceptance, settlement, a paid part, the recounts).
 * Such a receipt was reserved whole at acceptance, so it holds its whole
 * cents while its applied status reserves, and nothing otherwise. The live
 * path (`syncReceiptMoney`, `syncPaidPart`) and the paged recount
 * (`resyncReaderPage`) all read it here.
 */
export function reservedHeld(
  receipt: Pick<
    Doc<'tabReceipts'>,
    'moneyReservedCents' | 'moneyAppliedStatus'
  >,
  amountCents: number
): number {
  return (
    receipt.moneyReservedCents ??
    (reserves(receipt.moneyAppliedStatus) ? amountCents : 0)
  )
}

/** The reader's cents still reserved for a receipt: its unpaid part. */
export function unpaidCents(
  amountCents: number,
  amount: bigint,
  paidGross: bigint
): number {
  if (amount <= ZERO || paidGross <= ZERO) return amountCents
  if (paidGross >= amount) return 0
  return roundCents((amountCents * Number(amount - paidGross)) / Number(amount))
}

/**
 * The cents a receipt holds in its writer bucket: its whole share while
 * pending; nothing once settled (the lifetime totals count the paid net);
 * and on hold or not paid, its share minus the share of what was paid.
 */
export function bucketCents(
  bucket: Bucket,
  amountCents: number,
  net: bigint,
  amount: bigint,
  paid: PaidPart
): number {
  if (bucket === 'settled') return 0
  const share = tabShareCents(amountCents, net, amount)
  if (bucket === 'pending') return share
  return Math.max(
    0,
    roundCents(share - tabShareCents(amountCents, paid.net, amount))
  )
}

/**
 * Moves one receipt's money from the status already applied to its current
 * status. `amountCents` is the tip's cents at tip time; `net` its writer
 * share in base units (`receiptNet`); `paid` what of it the pair has paid.
 * The cents moved are stored on the receipt (`moneyAppliedCents`,
 * `moneyReservedCents`), so the next move takes out exactly what this one
 * put in.
 */
export async function syncReceiptMoney(
  ctx: MutationCtx,
  receipt: Doc<'tabReceipts'>,
  args: {
    amountCents: number
    net: bigint
    paid: PaidPart
    token: string
    now: number
  }
): Promise<void> {
  const from = receipt.moneyAppliedStatus ?? null
  const to = receipt.status
  if (from === to) return
  const { now } = args
  const amount = BigInt(receipt.amount)
  const share = tabShareCents(args.amountCents, args.net, amount)

  // Reader: the unpaid cents of a receipt that still reserves the balance.
  const reservedFrom = reservedHeld(receipt, args.amountCents)
  const reservedTo = reserves(to)
    ? unpaidCents(args.amountCents, amount, args.paid.gross)
    : 0
  const reservedDelta = roundCents(reservedTo - reservedFrom)
  if (reservedDelta !== 0) {
    const account = await ctx.db.get(receipt.tabAccountId)
    if (account) {
      await ctx.db.patch(account._id, {
        reservedCents: Math.max(
          0,
          roundCents((account.reservedCents ?? 0) + reservedDelta)
        ),
        updatedAt: now,
      })
    }
  }

  // Writer: pending, on hold, not paid (settled belongs to the lifetime totals).
  const row = await earningsRow(ctx, receipt.authorId, now)
  const patch: Partial<Doc<'authorEarnings'>> = { updatedAt: now }
  const add = (bucket: Bucket, cents: number, sign: 1 | -1) => {
    if (bucket === 'settled') return
    const c = CENTS_FIELD[bucket]
    const n = COUNT_FIELD[bucket]
    const current = (patch[c] ?? row[c] ?? 0) as number
    const count = (patch[n] ?? row[n] ?? 0) as number
    patch[c] = Math.max(0, roundCents(current + sign * cents))
    patch[n] = Math.max(0, count + sign)
  }
  if (from) {
    const fromBucket = bucketOf(from)
    add(
      fromBucket,
      receipt.moneyAppliedCents ?? (fromBucket === 'settled' ? 0 : share),
      -1
    )
  }
  const toCents = bucketCents(
    bucketOf(to),
    args.amountCents,
    args.net,
    amount,
    args.paid
  )
  add(bucketOf(to), toCents, 1)
  await ctx.db.patch(row._id, patch)
  await ctx.db.patch(receipt._id, {
    moneyAppliedStatus: to,
    moneyAppliedCents: toCents,
    moneyReservedCents: reservedTo,
  })
}

/**
 * A pair's paid amount grew over part of this receipt (the lifetime totals'
 * paid-range credit has just counted it as settled). Takes the newly paid
 * share out of the receipt's on-hold or not-paid cents, the newly paid gross
 * out of the reader's reserved cents, and matches collects held "ahead"
 * against the newly paid net.
 */
export async function syncPaidPart(
  ctx: MutationCtx,
  receipt: Doc<'tabReceipts'>,
  args: {
    amountCents: number
    before: PaidPart
    after: PaidPart
    token: string
    now: number
  }
): Promise<void> {
  const { now, token } = args
  const amount = BigInt(receipt.amount)
  const newlyNet = args.after.net - args.before.net
  if (newlyNet <= ZERO && args.after.gross <= args.before.gross) return
  const newlyShare = roundCents(
    tabShareCents(args.amountCents, args.after.net, amount) -
      tabShareCents(args.amountCents, args.before.net, amount)
  )
  const applied = receipt.moneyAppliedStatus
  const receiptPatch: Partial<Doc<'tabReceipts'>> = {}

  // Reader: a reserving receipt reserves only its unpaid part. One never
  // applied (from before the running figures) reserves by its own status:
  // the recount may already have counted and marked it.
  if (reserves(applied ?? receipt.status)) {
    const was = reservedHeld(receipt, args.amountCents)
    const now_ = unpaidCents(args.amountCents, amount, args.after.gross)
    if (now_ !== was) {
      const account = await ctx.db.get(receipt.tabAccountId)
      if (account)
        await ctx.db.patch(account._id, {
          reservedCents: Math.max(
            0,
            roundCents((account.reservedCents ?? 0) + now_ - was)
          ),
          updatedAt: now,
        })
    }
    // Recorded even when unchanged, so the next move reads a marker.
    if (now_ !== was || receipt.moneyReservedCents === undefined)
      receiptPatch.moneyReservedCents = now_
  }

  const row = await earningsRow(ctx, receipt.authorId, now)
  const patch: Partial<Doc<'authorEarnings'>> = {}
  // Writer: the paid part leaves on hold or not paid.
  const bucket = applied ? bucketOf(applied) : null
  if ((bucket === 'onHold' || bucket === 'notPaid') && newlyShare > 0) {
    const field = CENTS_FIELD[bucket]
    const held =
      receipt.moneyAppliedCents ??
      tabShareCents(args.amountCents, receiptNetOf(receipt), amount)
    const moved = Math.min(held, newlyShare)
    patch[field] = Math.max(0, roundCents((row[field] ?? 0) - moved))
    receiptPatch.moneyAppliedCents = roundCents(held - moved)
  }
  // Collects seen before this payment are matched against what it paid.
  const ahead = getBig(row.tabAheadBaseUnits, token)
  if (ahead > ZERO && newlyNet > ZERO) {
    const covered = ahead < newlyNet ? ahead : newlyNet
    const moved =
      covered === newlyNet
        ? newlyShare
        : roundCents((newlyShare * Number(covered)) / Number(newlyNet))
    patch.tabCollectedCents = roundCents((row.tabCollectedCents ?? 0) + moved)
    patch.tabMatchedBaseUnits = setBig(
      row.tabMatchedBaseUnits,
      token,
      getBig(row.tabMatchedBaseUnits, token) + covered
    )
    patch.tabAheadBaseUnits = setBig(
      row.tabAheadBaseUnits,
      token,
      ahead - covered
    )
  }
  if (Object.keys(patch).length > 0)
    await ctx.db.patch(row._id, { ...patch, updatedAt: now })
  if (Object.keys(receiptPatch).length > 0)
    await ctx.db.patch(receipt._id, receiptPatch)
}

/** `receiptNet` without importing the ledger (which imports this file). */
function receiptNetOf(
  r: Pick<Doc<'tabReceipts'>, 'amount' | 'cumulativeAfter'>
) {
  const netOf = (x: bigint) =>
    x - (x * BigInt(FEE_BPS)) / BigInt(BPS_DENOMINATOR)
  const after = BigInt(r.cumulativeAfter)
  return netOf(after) - netOf(after - BigInt(r.amount))
}

/**
 * Applies newly indexed collected base units (`collectedBaseUnits[token]`
 * beyond `tabCollectedAppliedBaseUnits[token]`) to collected cents by the
 * average-cost rule above. Idempotent.
 */
export async function syncCollectedCents(
  ctx: MutationCtx,
  userId: Id<'users'>,
  token: string,
  now: number
): Promise<void> {
  const row = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  if (!row) return
  const target = getBig(row.collectedBaseUnits, token)
  const applied = getBig(row.tabCollectedAppliedBaseUnits, token)
  const x = target - applied
  if (x <= ZERO) return
  const settled = tabSettledOf(row, token)
  const settledCents = settled.cents
  const collectedCents = row.tabCollectedCents ?? 0
  const availableCents = roundCents(settledCents - collectedCents)
  const matched = getBig(row.tabMatchedBaseUnits, token)
  const availableBase = settled.baseUnits - matched
  let moved = 0
  let matchedAdd = ZERO
  let aheadAdd = ZERO
  if (availableBase <= ZERO) {
    aheadAdd = x
  } else if (x >= availableBase) {
    moved = availableCents
    matchedAdd = availableBase
    aheadAdd = x - availableBase
  } else {
    moved = roundCents((availableCents * Number(x)) / Number(availableBase))
    matchedAdd = x
  }
  await ctx.db.patch(row._id, {
    tabCollectedCents: roundCents(collectedCents + moved),
    tabMatchedBaseUnits: setBig(
      row.tabMatchedBaseUnits,
      token,
      matched + matchedAdd
    ),
    tabAheadBaseUnits: setBig(
      row.tabAheadBaseUnits,
      token,
      getBig(row.tabAheadBaseUnits, token) + aheadAdd
    ),
    tabCollectedAppliedBaseUnits: setBig(
      row.tabCollectedAppliedBaseUnits,
      token,
      target
    ),
    updatedAt: now,
  })
}
