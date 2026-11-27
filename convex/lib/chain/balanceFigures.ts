/**
 * Running money figures for tab (balance) tips, so every total the screens
 * show is exact at any history length (no capped scan of receipts):
 *
 * - Reader: `tabAccounts.reservedCents`, the tip-time cents of the receipts
 *   that still reserve the balance (`ACCEPTED`, `SHORTFALL`). The base-unit
 *   twin is `tabAccounts.outstanding`.
 * - Writer (`authorEarnings`): the settled tips are the lifetime totals'
 *   `tabTipCount`, `tabEarnedCents` and `tabSettledBaseUnits`, written by
 *   `creditTipRowTotals` (below; the lifetime totals change, #552, brings its
 *   own). This file adds what that change does not keep: `tabPendingCents`
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
 * `totalEarnedCents`; screens floor them to whole cents. One token per row in
 * the slice: cents are not split by token.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { roundCents, tabShareCents } from '../authorEarnings'
import type { TabReceiptStatus } from './schema'

const ZERO = BigInt(0)

type TipRow = Doc<'tips'> | Doc<'highlightTips'>
export type TipTable = 'tips' | 'highlightTips'

/**
 * Adds a settled tab tip to its author's lifetime totals. Same name, call
 * site and tab rule as the lifetime totals change (#552,
 * `convex/lib/lifetimeEarnings.ts`), which also credits verified v1 tips
 * there and keeps a rebuild in step; when it merges, its function replaces
 * this one. Call it after the row is settled and after `creditAuthorEarnings`.
 */
export async function creditTipRowTotals(
  ctx: MutationCtx,
  userId: Id<'users'>,
  _table: TipTable,
  row: TipRow
): Promise<void> {
  if (row.channel !== 'tab' || row.earningsAppliedAt === undefined) return
  const earnings = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  if (!earnings) return
  const net = BigInt(row.netBaseUnits ?? '0')
  const token = row.tokenContractId ?? ''
  await ctx.db.patch(earnings._id, {
    tabTipCount: (earnings.tabTipCount ?? 0) + 1,
    tabEarnedCents: roundCents(
      (earnings.tabEarnedCents ?? 0) +
        tabShareCents(row.amountCents, net, BigInt(row.grossBaseUnits ?? '0'))
    ),
    tabSettledBaseUnits: {
      ...earnings.tabSettledBaseUnits,
      [token]: (
        BigInt(earnings.tabSettledBaseUnits?.[token] ?? '0') + net
      ).toString(),
    },
  })
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

/** Settled figures belong to `creditTipRowTotals`; these are the others. */
const CENTS_FIELD = {
  pending: 'tabPendingCents',
  onHold: 'tabOnHoldCents',
  notPaid: 'tabNotPaidCents',
} as const
const COUNT_FIELD = {
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
  const share = tabShareCents(
    args.amountCents,
    args.net,
    BigInt(receipt.amount)
  )

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
    if (bucket === 'settled') return
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
    // Match a collect that arrived before this settlement.
    const token = args.token
    const ahead = getBig(row.tabAheadBaseUnits, token)
    if (ahead > ZERO && args.net > ZERO) {
      const covered = ahead < args.net ? ahead : args.net
      const moved =
        covered === args.net
          ? share
          : roundCents((share * Number(covered)) / Number(args.net))
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
  }
  await ctx.db.patch(row._id, patch)
  await ctx.db.patch(receipt._id, { moneyAppliedStatus: to })
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
  const settledCents = row.tabEarnedCents ?? 0
  const collectedCents = row.tabCollectedCents ?? 0
  const availableCents = roundCents(settledCents - collectedCents)
  const matched = getBig(row.tabMatchedBaseUnits, token)
  const availableBase = getBig(row.tabSettledBaseUnits, token) - matched
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
