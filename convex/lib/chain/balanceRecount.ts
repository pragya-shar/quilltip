/**
 * Recounts the running money figures (`balanceFigures.ts`) from receipts,
 * for the backfill (`convex/balanceBackfill.ts`). One writer or one reader
 * per mutation, and never more than `RECOUNT_PAGE` receipts read in one, so
 * a recount stays inside a transaction's read limit at any history length.
 *
 * A writer or reader whose receipts fit in one page is recounted in one
 * mutation: the figures are summed again and written as absolute values,
 * and each receipt's applied status and cents are set. A concurrent
 * acceptance or settlement either sees the recount or is retried after it.
 *
 * One with more receipts is recounted a page per mutation, and each receipt
 * moves only its own difference: from what its markers (`moneyAppliedStatus`,
 * `moneyAppliedCents`, `moneyReservedCents`) say it holds to what it should
 * hold, in the same mutation that updates the markers. That is the live
 * path's own rule (`syncReceiptMoney`), so a tip accepted or settled between
 * two pages is counted once. A row figure that no receipt's markers account
 * for is left as it is on this path; no code writes one.
 *
 * Settled figures are the lifetime totals' (`tabTipCount`, `tabEarnedCents`,
 * `tabSettledBaseUnits`, #552), which their own rebuild
 * (`earningsTotalsBackfill`) fills; this file only reads them. Run this
 * after that rebuild. Running either again is safe: this recount writes the
 * same values from the same receipts and totals.
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
import {
  bucketCents,
  bucketOf,
  CENTS_FIELD,
  COUNT_FIELD,
  earningsRow,
  reserves,
  unpaidCents,
  type Bucket,
} from './balanceFigures'
import { paidPartOf, receiptNet, tabVoucher } from './tabLedger'

const ZERO = BigInt(0)
type TipRow = Doc<'tips'> | Doc<'highlightTips'>

/** Receipts read in one mutation of a recount, at most. */
export const RECOUNT_PAGE = 200

/** `done`: recounted in one mutation; `paged`: too many, page instead. */
export type RecountOutcome = 'none' | 'done' | 'paged'

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

/** What a receipt should hold now, writer and reader side. */
async function targetOf(
  ctx: MutationCtx,
  r: Doc<'tabReceipts'>,
  paidOf: ReturnType<typeof pairPaid>
) {
  const amount = BigInt(r.amount)
  const amountCents = await centsOf(ctx, r)
  const paid = paidPartOf(r, await paidOf(r))
  const bucket = bucketOf(r.status)
  return {
    amountCents,
    share: tabShareCents(amountCents, receiptNet(r), amount),
    bucket,
    held: bucketCents(bucket, amountCents, receiptNet(r), amount, paid),
    reserved: reserves(r.status)
      ? unpaidCents(amountCents, amount, paid.gross)
      : 0,
  }
}

/** Collected bookkeeping rebuilt from the settled totals (reads the row only). */
export async function rebuildCollected(
  ctx: MutationCtx,
  userId: Id<'users'>,
  token: string,
  now: number,
  figures: Partial<Doc<'authorEarnings'>> = {}
): Promise<void> {
  const row = await earningsRow(ctx, userId, now)
  // Settled figures are the lifetime totals'; read, never written here.
  const settled = tabSettledOf(row, token)
  const collected = BigInt(row.collectedBaseUnits?.[token] ?? '0')
  const rebuilt = rebuiltCollected(settled.cents, settled.baseUnits, collected)
  await ctx.db.patch(row._id, {
    ...figures,
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
}

/**
 * Recounts one writer's figures in this mutation when their receipts fit
 * in one page (`done`); `paged` when they do not (nothing written: page with
 * `resyncWriterPage`, then `rebuildCollected`); `none` without receipts.
 */
export async function recountWriter(
  ctx: MutationCtx,
  userId: Id<'users'>,
  token: string,
  now: number
): Promise<RecountOutcome> {
  const receipts = await ctx.db
    .query('tabReceipts')
    .withIndex('by_author_accepted', (q) => q.eq('authorId', userId))
    .take(RECOUNT_PAGE + 1)
  if (receipts.length === 0) return 'none'
  if (receipts.length > RECOUNT_PAGE) return 'paged'
  const paidOf = pairPaid(ctx)
  const cents = { pending: 0, onHold: 0, notPaid: 0 }
  const counts = { pending: 0, onHold: 0, notPaid: 0 }
  for (const r of receipts) {
    const target = await targetOf(ctx, r, paidOf)
    if (target.bucket !== 'settled') {
      cents[target.bucket] = roundCents(cents[target.bucket] + target.held)
      counts[target.bucket] += 1
    }
    if (
      r.moneyAppliedStatus !== r.status ||
      r.moneyAppliedCents !== target.held ||
      r.moneyReservedCents !== target.reserved
    )
      await ctx.db.patch(r._id, {
        moneyAppliedStatus: r.status,
        moneyAppliedCents: target.held,
        moneyReservedCents: target.reserved,
      })
  }
  await rebuildCollected(ctx, userId, token, now, {
    tabPendingCents: cents.pending,
    tabPendingCount: counts.pending,
    tabOnHoldCents: cents.onHold,
    tabOnHoldCount: counts.onHold,
    tabNotPaidCents: cents.notPaid,
    tabNotPaidCount: counts.notPaid,
  })
  return 'done'
}

/**
 * One page of a writer's receipts: each moves its own difference into the
 * writer's buckets and records it on its markers, as the live path does.
 */
export async function resyncWriterPage(
  ctx: MutationCtx,
  userId: Id<'users'>,
  cursor: string | null,
  now: number
): Promise<{ cursor: string; isDone: boolean }> {
  const page = await ctx.db
    .query('tabReceipts')
    .withIndex('by_author_accepted', (q) => q.eq('authorId', userId))
    .paginate({ cursor, numItems: RECOUNT_PAGE })
  const paidOf = pairPaid(ctx)
  const row = await earningsRow(ctx, userId, now)
  const patch: Partial<Doc<'authorEarnings'>> = {}
  const move = (bucket: Bucket, cents: number, count: number) => {
    if (bucket === 'settled') return
    const c = CENTS_FIELD[bucket]
    const n = COUNT_FIELD[bucket]
    patch[c] = Math.max(
      0,
      roundCents(((patch[c] ?? row[c] ?? 0) as number) + cents)
    )
    patch[n] = Math.max(0, ((patch[n] ?? row[n] ?? 0) as number) + count)
  }
  for (const r of page.page) {
    const target = await targetOf(ctx, r, paidOf)
    const from = r.moneyAppliedStatus ?? null
    if (from === r.status && r.moneyAppliedCents === target.held) continue
    if (from) {
      const fromBucket = bucketOf(from)
      move(
        fromBucket,
        -(r.moneyAppliedCents ?? (fromBucket === 'settled' ? 0 : target.share)),
        -1
      )
    }
    move(target.bucket, target.held, 1)
    await ctx.db.patch(r._id, {
      moneyAppliedStatus: r.status,
      moneyAppliedCents: target.held,
    })
  }
  if (Object.keys(patch).length)
    await ctx.db.patch(row._id, { ...patch, updatedAt: now })
  return { cursor: page.continueCursor, isDone: page.isDone }
}

/**
 * Recounts one reader's reserved cents (unpaid parts) in this mutation when
 * their receipts fit in one page; `paged` when they do not (nothing written:
 * page with `resyncReaderPage`).
 */
export async function recountReader(
  ctx: MutationCtx,
  account: Doc<'tabAccounts'>,
  now: number
): Promise<RecountOutcome> {
  const receipts = await ctx.db
    .query('tabReceipts')
    .withIndex('by_account_accepted', (q) => q.eq('tabAccountId', account._id))
    .take(RECOUNT_PAGE + 1)
  if (receipts.length > RECOUNT_PAGE) return 'paged'
  const paidOf = pairPaid(ctx)
  let reserved = 0
  for (const r of receipts)
    reserved = roundCents(reserved + (await targetOf(ctx, r, paidOf)).reserved)
  if (account.reservedCents !== reserved)
    await ctx.db.patch(account._id, { reservedCents: reserved, updatedAt: now })
  return receipts.length ? 'done' : 'none'
}

/**
 * One page of a reader's receipts: each moves its own difference in
 * reserved cents and records it on `moneyReservedCents`, as the live path
 * does (an unmarked receipt holds its whole cents while it reserves).
 */
export async function resyncReaderPage(
  ctx: MutationCtx,
  accountId: Id<'tabAccounts'>,
  cursor: string | null,
  now: number
): Promise<{ cursor: string; isDone: boolean }> {
  const page = await ctx.db
    .query('tabReceipts')
    .withIndex('by_account_accepted', (q) => q.eq('tabAccountId', accountId))
    .paginate({ cursor, numItems: RECOUNT_PAGE })
  const paidOf = pairPaid(ctx)
  let delta = 0
  for (const r of page.page) {
    const target = await targetOf(ctx, r, paidOf)
    const held =
      r.moneyReservedCents ??
      (reserves(r.moneyAppliedStatus) ? target.amountCents : 0)
    if (held === target.reserved && r.moneyReservedCents !== undefined) continue
    delta = roundCents(delta + target.reserved - held)
    await ctx.db.patch(r._id, { moneyReservedCents: target.reserved })
  }
  const account = await ctx.db.get(accountId)
  if (account && delta !== 0)
    await ctx.db.patch(account._id, {
      reservedCents: Math.max(
        0,
        roundCents((account.reservedCents ?? 0) + delta)
      ),
      updatedAt: now,
    })
  return { cursor: page.continueCursor, isDone: page.isDone }
}
