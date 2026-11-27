/**
 * Money views for the reader's balance and the writer's earnings
 * (`convex/balance.ts`, `convex/activity.ts`, `convex/earnings.ts`): the
 * rules they share and the reads they share. Nothing here writes. Totals are
 * running figures kept by the ledger (`lib/chain/balanceFigures.ts`, plus
 * `tabAccounts.outstanding` and `authorEarnings`); lists are paged.
 *
 * Money invariants (proved in `scripts/chain/money-views.test.ts`):
 *
 * - **M1, one tip, one row.** Every accepted tip has exactly one
 *   `tabReceipts` row: acceptance is idempotent on the tip's `clientRef`
 *   (one per prepared row, and a prepared row is idempotent on `requestId`).
 *   Lists read receipts, and each running figure moves a receipt's money
 *   once per state change (`moneyAppliedStatus`), so each tip is listed and
 *   counted once on each side, in every settlement state.
 * - **M2, spendable.** `spendable = readerSpendable(account) =
 *   max(0, confirmedBalance - outstanding)`; `outstanding` is the unpaid
 *   value of the reader's `ACCEPTED` and `SHORTFALL` receipts, so spendable
 *   never exceeds the on-chain balance minus the accepted value not yet paid
 *   on chain. An accepted tip leaves spendable in the accepting mutation and
 *   returns only when the server closes its pair as `UNPAID`, `REJECTED` or
 *   `VOID_RESET`. (Known gap, fixed in the ledger elsewhere: between a
 *   settler's own confirmed result and the indexed `TabSettled`.)
 * - **M3, pending, available, collected.** Per receipt, `ACCEPTED` is
 *   pending, `SETTLED` is settled, `SHORTFALL` is on hold, and `UNPAID`,
 *   `REJECTED`, `VOID_RESET` are not paid. Available is settled minus
 *   collected. Pending, available and collected are disjoint and sum to the
 *   lifetime total of tips that did not fail; adding on hold and not paid
 *   gives every accepted tip. Net follows the contract's cumulative fee rule
 *   (`receiptNet`), and a tip's dollars are its tip-time cents times its net
 *   share (`shareCentsOf`, the rule `authorEarnings.totalEarnedCents` uses).
 * - **M4, a failure never pays.** A receipt reaches `SETTLED` only through a
 *   `TabSettled` payment that covers it. A skip, `UNPAID` or `REJECTED`
 *   moves money out of pending into on hold or not paid; it never adds to
 *   available.
 * - **M5, collects.** An indexed `Claimed` moves cents from available to
 *   collected by average cost, once per event, in any order relative to the
 *   settlement that funded it; `available + collected = settled` exactly.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { readChainEnv } from './chain/env'
import type { TabReceiptStatus } from './chain/schema'
import { settleAfterAcceptMs } from './chain/settleSchedule'
import { dueRuleFromEnv } from './chain/settler'
import { shareCentsOf } from './chain/balanceFigures'
import { centsToStroops, receiptNet } from './chain/tabLedger'
import { verifiedStellarAddress } from './walletVerification'

type EnvLike = Record<string, string | undefined>

const STROOPS_PER_XLM = 10_000_000
const ZERO = BigInt(0)

/** The slice's settlement states of one tip (v3 `SettlementState`). */
export type MoneyState = 'accepted' | 'on-chain' | 'not-paid'

/**
 * Why a tip is not paid. `shortfall`: the reader's on-chain balance did not
 * cover it when it was paid out; it is paid if the reader adds funds.
 * `expired`: the window to pay it ended. `rejected`: it failed the checks at
 * payout. `reset`: the test network was reset.
 */
export type NotPaidReason = 'shortfall' | 'expired' | 'rejected' | 'reset'

export function moneyStateOf(status: TabReceiptStatus): {
  state: MoneyState
  reason: NotPaidReason | null
} {
  switch (status) {
    case 'ACCEPTED':
      return { state: 'accepted', reason: null }
    case 'SETTLED':
      return { state: 'on-chain', reason: null }
    case 'SHORTFALL':
      return { state: 'not-paid', reason: 'shortfall' }
    case 'UNPAID':
      return { state: 'not-paid', reason: 'expired' }
    case 'REJECTED':
      return { state: 'not-paid', reason: 'rejected' }
    case 'VOID_RESET':
      return { state: 'not-paid', reason: 'reset' }
  }
}

/** The writer's share of a receipt in cents (1/10,000-cent grid). */
export function receiptShareCents(
  receipt: Pick<Doc<'tabReceipts'>, 'amount' | 'cumulativeAfter'>,
  amountCents: number
): number {
  return shareCentsOf(BigInt(receipt.amount), receiptNet(receipt), amountCents)
}

/** US cents a base-unit amount is worth at `priceUsd` per XLM, floored. */
export function centsFromBaseUnits(base: bigint, priceUsd: number): number {
  if (base <= ZERO || !(priceUsd > 0) || !Number.isFinite(priceUsd)) return 0
  return Math.floor((Number(base) * priceUsd * 100) / STROOPS_PER_XLM)
}

/** The smallest whole-cent tip whose base units reach `minTip`. */
export function minimumTipCents(minTip: bigint, priceUsd: number): number {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return 0
  let cents = Math.max(
    1,
    Math.ceil((Number(minTip) * priceUsd * 100) / STROOPS_PER_XLM)
  )
  while (centsToStroops(cents, priceUsd) < minTip) cents++
  return cents
}

/**
 * How long settlement normally takes on this deployment, so the screens can
 * say plainly when it lags. With a run after acceptance: the delay plus a
 * minute for the transaction and the indexer. Otherwise the due age plus
 * the 10 minute cron. Depends on configuration only, never on the clock, so
 * a subscribed query stays valid as time passes.
 */
export function settlementExpectation(env: EnvLike = process.env): {
  enabled: boolean
  expectedWithinMs: number
} {
  const enabled = env.SETTLEMENT_ENABLED?.trim() === 'true'
  const after = settleAfterAcceptMs(env)
  const expectedWithinMs =
    after !== null ? after + 60_000 : dueRuleFromEnv(env).ageMs + 10 * 60 * 1000
  return { enabled, expectedWithinMs }
}

// ---------------------------------------------------------------------------
// Shared reads

export type Caller = {
  userId: Id<'users'>
  user: Doc<'users'>
  /** The verified Stellar address on this network, or null. */
  address: string | null
  chain: ReturnType<typeof readChainEnv>
}

export async function caller(ctx: QueryCtx): Promise<Caller | null> {
  const userId = await getAuthUserId(ctx)
  if (!userId) return null
  const user = await ctx.db.get(userId)
  if (!user) return null
  const chain = readChainEnv()
  return {
    userId,
    user,
    address: verifiedStellarAddress(user, chain.passphrase),
    chain,
  }
}

/** The tip row a receipt was accepted for (`tips` or `highlightTips`). */
export async function tipRowOf(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>
): Promise<Doc<'tips'> | Doc<'highlightTips'> | null> {
  return (await ctx.db.get(receipt.tipRowId)) as
    | Doc<'tips'>
    | Doc<'highlightTips'>
    | null
}

/** The cents stored at tip time: on the receipt, else on its tip row. */
export async function receiptCents(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>
): Promise<number> {
  if (typeof receipt.amountCents === 'number') return receipt.amountCents
  return (await tipRowOf(ctx, receipt))?.amountCents ?? 0
}

/** The cached XLM price, or null. */
export async function cachedPrice(
  ctx: QueryCtx
): Promise<{ usd: number; at: number } | null> {
  const price = await ctx.db.query('xlmPriceCache').first()
  if (!price || !(price.priceUsd > 0) || !Number.isFinite(price.priceUsd))
    return null
  return { usd: price.priceUsd, at: price.fetchedAt }
}

/** The transaction that paid a settled receipt, when it is recorded. */
export async function settledTxHash(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>
): Promise<string | null> {
  if (receipt.status !== 'SETTLED') return null
  if (receipt.settledEventId) {
    const event = await ctx.db
      .query('chainEvents')
      .withIndex('by_event_id', (q) => q.eq('eventId', receipt.settledEventId!))
      .first()
    if (event?.txHash) return event.txHash
  }
  if (receipt.settlementId) {
    const settlement = await ctx.db.get(receipt.settlementId)
    if (settlement?.txHash) return settlement.txHash
  }
  const pair = await ctx.db
    .query('tabVouchers')
    .withIndex('by_pair', (q) =>
      q
        .eq('tabAccountId', receipt.tabAccountId)
        .eq('keyId', receipt.keyId)
        .eq('writerAddress', receipt.writerAddress)
    )
    .first()
  if (pair?.lastSettledEventId) {
    const event = await ctx.db
      .query('chainEvents')
      .withIndex('by_event_id', (q) =>
        q.eq('eventId', pair.lastSettledEventId!)
      )
      .first()
    if (event?.txHash) return event.txHash
  }
  if (!pair) return null
  const recent = await ctx.db
    .query('tabSettlements')
    .withIndex('by_status', (q) => q.eq('status', 'CONFIRMED'))
    .order('desc')
    .take(50)
  return recent.find((s) => s.voucherIds.includes(pair._id))?.txHash ?? null
}

export const PASSAGE_PREVIEW_CHARS = 160

/** The passage of a highlight tip, shortened for a list row. */
export function passagePreview(
  row: Doc<'tips'> | Doc<'highlightTips'> | null
): string | null {
  if (!row || !('highlightText' in row) || !row.highlightText) return null
  const text = row.highlightText.replace(/\s+/g, ' ').trim()
  return text.length > PASSAGE_PREVIEW_CHARS
    ? `${text.slice(0, PASSAGE_PREVIEW_CHARS - 1).trimEnd()}…`
    : text
}
