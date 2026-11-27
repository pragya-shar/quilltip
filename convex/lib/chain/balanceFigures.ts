/**
 * Running money figures for balance (tab) tips, so every total the screens
 * show is exact at any history length (no capped scan of receipts):
 *
 * - Reader: `tabAccounts.reservedCents`, the tip-time cents of the receipts
 *   that still reserve the balance (`ACCEPTED`, `SHORTFALL`). The base-unit
 *   twin is `tabAccounts.outstanding`.
 * - Writer (`authorEarnings`, the same row and scope as `totalEarnedCents`):
 *   `balancePendingCents` (`ACCEPTED`), `balanceSettledCents` (`SETTLED`;
 *   also credited to `totalEarnedCents` by `setReceiptStatus`),
 *   `balanceOnHoldCents` (`SHORTFALL`), `balanceNotPaidCents` (`UNPAID`,
 *   `REJECTED`, `VOID_RESET`), each with a count, and `balanceCollectedCents`.
 *
 * `syncReceiptMoney` is the only writer of the receipt buckets. It moves a
 * receipt's money from `moneyAppliedStatus` to its current `status` and
 * records the new applied status in the same mutation, so it is idempotent,
 * runs once per transition, and also backfills receipts accepted before the
 * figures existed. Acceptance and `setReceiptStatus` call it.
 *
 * Collected cents. A collect is in base units (the indexed `Claimed`
 * amount); tips carry cents at their own price. Rule: average cost. A
 * collect of `x` base units moves `availableCents * x / availableBase` cents
 * from available to collected (all of available when `x` covers it), where
 * `available = settled - collected`. Collected cents are only ever moved
 * from settled cents, so `available + collected = settled` holds exactly
 * after any sequence of collects, with no drift. A collect seen before the
 * settlement that funded it (out-of-order indexing) is held as "ahead" and
 * matched against the next settled receipts as they arrive.
 * `syncCollectedCents` applies the difference between the indexed
 * `collectedBaseUnits` and the part already applied, so a replayed event
 * changes nothing.
 *
 * Cents are on the 1/10,000-cent grid of `roundCents`, like
 * `totalEarnedCents`. One token per row in the slice: cents are not split by
 * token.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { roundCents } from '../authorEarnings'
import type { TabReceiptStatus } from './schema'

const ZERO = BigInt(0)

/** The writer's share of a receipt's tip-time cents, under the fee rule. */
export function shareCentsOf(
  gross: bigint,
  net: bigint,
  amountCents: number
): number {
  if (gross <= ZERO) return 0
  return roundCents(
    amountCents * (Number((net * BigInt(1_000_000)) / gross) / 1_000_000)
  )
}

type Bucket = 'pending' | 'settled' | 'onHold' | 'notPaid'

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

const CENTS_FIELD = {
  pending: 'balancePendingCents',
  settled: 'balanceSettledCents',
  onHold: 'balanceOnHoldCents',
  notPaid: 'balanceNotPaidCents',
} as const
const COUNT_FIELD = {
  pending: 'balancePendingCount',
  settled: 'balanceSettledCount',
  onHold: 'balanceOnHoldCount',
  notPaid: 'balanceNotPaidCount',
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
async function earningsRow(
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

/**
 * Moves one receipt's money from the status already applied to its current
 * status. `amountCents` is the tip's cents at tip time; `net` its writer
 * share in base units (`receiptNet`).
 */
export async function syncReceiptMoney(
  ctx: MutationCtx,
  receipt: Doc<'tabReceipts'>,
  args: { amountCents: number; net: bigint; token: string; now: number }
): Promise<void> {
  const from = receipt.moneyAppliedStatus ?? null
  const to = receipt.status
  if (from === to) return
  const { now } = args
  const share = shareCentsOf(BigInt(receipt.amount), args.net, args.amountCents)

  // Reader: reserved cents.
  const reservedDelta =
    (reserves(to) ? args.amountCents : 0) -
    (reserves(from) ? args.amountCents : 0)
  if (reservedDelta !== 0) {
    const account = await ctx.db.get(receipt.tabAccountId)
    if (account) {
      await ctx.db.patch(account._id, {
        reservedCents: Math.max(
          0,
          (account.reservedCents ?? 0) + reservedDelta
        ),
        updatedAt: now,
      })
    }
  }

  // Writer: buckets, counts, and the collected-cents bookkeeping.
  const row = await earningsRow(ctx, receipt.authorId, now)
  const patch: Partial<Doc<'authorEarnings'>> = { updatedAt: now }
  const add = (bucket: Bucket, sign: 1 | -1) => {
    const cents = CENTS_FIELD[bucket]
    const count = COUNT_FIELD[bucket]
    const current = (patch[cents] ?? row[cents] ?? 0) as number
    const n = (patch[count] ?? row[count] ?? 0) as number
    patch[cents] = Math.max(0, roundCents(current + sign * share))
    patch[count] = Math.max(0, n + sign)
  }
  if (from) add(bucketOf(from), -1)
  add(bucketOf(to), 1)

  if (to === 'SETTLED') {
    const token = args.token
    patch.balanceSettledBaseUnits = setBig(
      row.balanceSettledBaseUnits,
      token,
      getBig(row.balanceSettledBaseUnits, token) + args.net
    )
    // Match a collect that arrived before this settlement.
    const ahead = getBig(row.balanceAheadBaseUnits, token)
    if (ahead > ZERO && args.net > ZERO) {
      const covered = ahead < args.net ? ahead : args.net
      const moved =
        covered === args.net
          ? share
          : roundCents((share * Number(covered)) / Number(args.net))
      patch.balanceCollectedCents = roundCents(
        (row.balanceCollectedCents ?? 0) + moved
      )
      patch.balanceMatchedBaseUnits = setBig(
        row.balanceMatchedBaseUnits,
        token,
        getBig(row.balanceMatchedBaseUnits, token) + covered
      )
      patch.balanceAheadBaseUnits = setBig(
        row.balanceAheadBaseUnits,
        token,
        ahead - covered
      )
    }
  }
  await ctx.db.patch(row._id, patch)
  await ctx.db.patch(receipt._id, { moneyAppliedStatus: to })
}

/**
 * Applies newly indexed collected base units (`collectedBaseUnits[token]`
 * beyond `balanceCollectedAppliedBaseUnits[token]`) to collected cents by
 * the average-cost rule above. Idempotent.
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
  const applied = getBig(row.balanceCollectedAppliedBaseUnits, token)
  const x = target - applied
  if (x <= ZERO) return
  const settledCents = row.balanceSettledCents ?? 0
  const collectedCents = row.balanceCollectedCents ?? 0
  const availableCents = roundCents(settledCents - collectedCents)
  const matched = getBig(row.balanceMatchedBaseUnits, token)
  const availableBase = getBig(row.balanceSettledBaseUnits, token) - matched
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
    balanceCollectedCents: roundCents(collectedCents + moved),
    balanceMatchedBaseUnits: setBig(
      row.balanceMatchedBaseUnits,
      token,
      matched + matchedAdd
    ),
    balanceAheadBaseUnits: setBig(
      row.balanceAheadBaseUnits,
      token,
      getBig(row.balanceAheadBaseUnits, token) + aheadAdd
    ),
    balanceCollectedAppliedBaseUnits: setBig(
      row.balanceCollectedAppliedBaseUnits,
      token,
      target
    ),
    updatedAt: now,
  })
}
