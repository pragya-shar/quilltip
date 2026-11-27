/**
 * Money views for the reader's balance and the writer's earnings
 * (`convex/balance.ts`, `convex/activity.ts`, `convex/earnings.ts`). Pure
 * derivations from the tab ledger plus the reads they share. Nothing here
 * writes; the ledger's own writers are the acceptance path
 * (`tabLedger.submitTabTip`) and the Tab event handlers.
 *
 * Money invariants (proved in `scripts/chain/money-views.test.ts`):
 *
 * - **M1, one tip, one row.** Every accepted tip has exactly one
 *   `tabReceipts` row: acceptance is idempotent on the tip's `clientRef`
 *   (one per prepared row, and a prepared row is idempotent on `requestId`).
 *   The reader's activity, the writer's activity and the earnings sums all
 *   read receipts, never tip rows or vouchers, so each tip is listed and
 *   counted once on each side, in every settlement state.
 * - **M2, spendable.** `spendable = max(0, confirmedBalance - outstanding)`,
 *   where `outstanding` is the unpaid value of the reader's `ACCEPTED` and
 *   `SHORTFALL` receipts. It never exceeds the on-chain balance minus the
 *   accepted value not yet paid on chain. An accepted tip leaves spendable in
 *   the accepting mutation and returns only when the server closes its pair
 *   as `UNPAID`, `REJECTED` or `VOID_RESET`.
 * - **M3, pending and available.** For the writer, per receipt:
 *   `ACCEPTED` is pending, `SETTLED` is available, `SHORTFALL` is on hold,
 *   and `UNPAID`, `REJECTED` and `VOID_RESET` are not paid. Hence
 *   `pending + available` is the net of every accepted tip that has not
 *   failed, and `pending + available + onHold + notPaid` is the net of every
 *   accepted tip. Net follows the contract's cumulative fee rule
 *   (`receiptNet`: 2.5% of the pair's cumulative amount, floored), so per
 *   pair it telescopes to `netOf(cumulative)`.
 * - **M4, a failure never pays.** A receipt reaches `SETTLED` only through a
 *   `TabSettled` payment that covers it. A skip, `UNPAID` or `REJECTED`
 *   moves receipts out of pending into on hold or not paid; it never adds
 *   to available.
 *
 * Dollar figures are the cents stored at tip time (`amountCents`), never a
 * re-conversion. The writer's net in cents is the tip's cents times its
 * net share in base units, kept in milli-cents so sums stay exact, and shown
 * floored to the cent so a total never shows more than was earned.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { readChainEnv } from './chain/env'
import type { TabReceiptStatus } from './chain/schema'
import { settleAfterAcceptMs } from './chain/settleSchedule'
import { dueRuleFromEnv } from './chain/settler'
import { centsToStroops, receiptNet } from './chain/tabLedger'
import { verifiedStellarAddress } from './walletVerification'

type EnvLike = Record<string, string | undefined>

const STROOPS_PER_XLM = 10_000_000
const ZERO = BigInt(0)
const MILLI = BigInt(1000)

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

/** The receipt's value still reserved against the reader's balance. */
export function reservesBalance(status: TabReceiptStatus): boolean {
  return status === 'ACCEPTED' || status === 'SHORTFALL'
}

/**
 * The writer's net of one receipt in milli-cents: the tip's cents times
 * `receiptNet / amount`, floored. Exact integer arithmetic.
 */
export function netMilliCents(
  receipt: Pick<Doc<'tabReceipts'>, 'amount' | 'cumulativeAfter'>,
  amountCents: number
): bigint {
  const gross = BigInt(receipt.amount)
  if (gross <= ZERO || !Number.isSafeInteger(amountCents) || amountCents <= 0)
    return ZERO
  return (receiptNet(receipt) * BigInt(amountCents) * MILLI) / gross
}

/** Milli-cents shown as whole cents, floored. */
export function milliToCents(milli: bigint): number {
  return Number(milli / MILLI)
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
