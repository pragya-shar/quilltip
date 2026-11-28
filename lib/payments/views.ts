/**
 * Pure mappers from the reactive Convex reads (`balance.session`,
 * `activity.mine`, `earnings.mine`) and this browser's outbox to the view
 * models the screens render. Reconciliation rule: an outbox entry counts
 * against the balance and shows as "Sending" only until the same snapshot of
 * `balance.session` lists its `requestId` as accepted; from then on the
 * server's figures alone hold it. So a tip is never counted twice, and never
 * missing, at any moment.
 */
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import { baseUnitsToCents, convertedMoney, money } from './money'
import type { OutboxEntry } from './outbox'
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
  EarningsView,
  Money,
} from './types'

export type SessionRead = FunctionReturnType<typeof api.balance.session>
export type ActivityEntry = FunctionReturnType<
  typeof api.activity.mine
>['page'][number]
export type EarningsRead = FunctionReturnType<typeof api.earnings.mine>
/** Public tip terms for a signed-out visitor (`balance.publicTipTerms`). */
export type PublicTerms = FunctionReturnType<typeof api.balance.publicTipTerms>

/** The amounts a signed-out visitor's button offers: the cap and minimum
 * only, never a balance or a daily remainder. */
export function publicChoices(terms: PublicTerms | undefined): number[] {
  if (!terms) return []
  return tipChoices({
    minCents: terms.minTipCents ?? 1,
    perTipCents: Math.min(terms.perTipCents, terms.quickTipMaxCents),
    dailyLeftCents: Number.POSITIVE_INFINITY,
    spendableCents: Number.POSITIVE_INFINITY,
  }).amounts
}

/** Pending tips older than this read as taking longer than usual. */
export const LAG_NOTICE_MS = 5 * 60 * 1000

/**
 * The one ladder of tip amounts, in cents. The control offers the amounts
 * of this ladder that fit every bound at that moment (the minimum tip, the
 * per-tip cap, what is left of today's limit, and the spendable balance):
 * the largest `MAX_CHOICES` that fit, ascending. A raw ceiling (such as
 * 63 cents) is never an amount. The default is $1 when it fits, otherwise
 * the smallest amount offered; a reader's choice is never raised.
 */
export const TIP_LADDER = [10, 25, 50, 100, 200, 300, 500] as const
export const MAX_CHOICES = 4
export const DEFAULT_CHOICE_CENTS = 100

/** Why no amount of the ladder fits (`price`: no price to convert with). */
export type NoAmountReason = 'cap' | 'daily' | 'balance' | 'price'

export function tipChoices(bounds: {
  minCents: number
  perTipCents: number
  dailyLeftCents: number
  spendableCents: number
}): { amounts: number[]; reason: NoAmountReason | null } {
  const capped = TIP_LADDER.filter(
    (c) => c >= bounds.minCents && c <= bounds.perTipCents
  )
  if (capped.length === 0) return { amounts: [], reason: 'cap' }
  const today = capped.filter((c) => c <= bounds.dailyLeftCents)
  if (today.length === 0) return { amounts: [], reason: 'daily' }
  const fits = today.filter((c) => c <= bounds.spendableCents)
  if (fits.length === 0) return { amounts: [], reason: 'balance' }
  return { amounts: fits.slice(-MAX_CHOICES), reason: null }
}

/** $1 when offered, else the smallest offered amount, else none. */
export function defaultChoice(amounts: readonly number[]): number | null {
  if (amounts.includes(DEFAULT_CHOICE_CENTS)) return DEFAULT_CHOICE_CENTS
  return amounts[0] ?? null
}

/**
 * The amount the button states and sends: the reader's choice while it is
 * offered, else the largest offered amount not above it, else none. Never
 * above the choice.
 */
export function effectiveChoice(
  chosen: number | null,
  amounts: readonly number[]
): number | null {
  if (chosen === null) return defaultChoice(amounts)
  if (amounts.includes(chosen)) return chosen
  const below = amounts.filter((c) => c <= chosen)
  return below.length ? below[below.length - 1]! : null
}

/**
 * A tip intent carried through sign-in: its `amount` is a ceiling. Against
 * the reader's own ladder it is never raised: the amount if offered, else
 * the largest offered amount below it, else none. (`setAmount` applies the
 * same rule, so a surface can pass the intent's amount to it.)
 */
export function clampIntent(
  ceilingCents: number,
  amounts: readonly number[]
): number | null {
  return effectiveChoice(ceilingCents, amounts)
}

export type DeviceState = BalanceView['device']

/** Entries of the outbox that the session does not list as accepted yet. */
export function unansweredEntries(
  outbox: OutboxEntry[],
  session: SessionRead | undefined
): OutboxEntry[] {
  const accepted = new Set(session?.recentRequestIds ?? [])
  return outbox.filter((e) => !accepted.has(e.requestId))
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function balanceViewOf(input: {
  authLoading: boolean
  signedIn: boolean
  session: SessionRead | undefined
  outbox: OutboxEntry[]
  device: DeviceState
  online: boolean
  now: number
  /** When the figures were last known current (`useAsOf`). */
  asOf?: number | null
}): BalanceView {
  const { session } = input
  const base: BalanceView = {
    status: 'loading',
    available: null,
    pending: null,
    deviceReady: false,
    device: input.device,
    limits: null,
    amounts: [],
    noAmountReason: null,
    settlement: session?.settlement ?? {
      enabled: false,
      expectedWithinMs: LAG_NOTICE_MS,
    },
    online: input.online,
    network: 'testnet',
    exact: null,
    asOf: null,
    price: null,
  }
  if (input.authLoading) return base
  if (!input.signedIn || session === null)
    return { ...base, status: 'signed-out' }
  if (session === undefined) return base
  // The price the conversion uses, the same one the server's figure used.
  // Floored to four decimals of a dollar, as every conversion is.
  const read =
    session.prices[0] &&
    session.prices[0].usd > 0 &&
    Number.isFinite(session.prices[0].usd)
      ? session.prices[0]
      : null
  const priceView = read
    ? {
        perToken: money(Math.floor(read.usd * 10_000 + 1e-6) / 100),
        asOf: read.at,
      }
    : null
  // The server answered: no balance yet is a real zero.
  if (session.status === 'none')
    return {
      ...base,
      status: 'none',
      // No balance is held: an exact zero, not a conversion.
      available: money(0),
      pending: money(0),
      exact: null,
      asOf: input.asOf ?? null,
      price: null,
    }

  const price = read?.usd ?? 0
  const sending = unansweredEntries(input.outbox, session)
  const reserved = sending.reduce(
    (sum, e) => sum + BigInt(e.estimate),
    BigInt(0)
  )
  const serverAvailable = BigInt(session.tokens[0]?.available ?? '0')
  const left = serverAvailable - reserved
  const availableCents = baseUnitsToCents(
    left > BigInt(0) ? left : BigInt(0),
    price
  )
  const sendingCents = sending.reduce((sum, e) => sum + e.amountCents, 0)

  const l = session.limits
  let limits: BalanceView['limits'] = null
  let amounts: Money[] = []
  let noAmountReason: NoAmountReason | null = null
  if (l) {
    const usedToday =
      (l.acceptedDay === utcDay(input.now) ? l.acceptedTodayCents : 0) +
      sendingCents
    const dailyLeft = Math.max(0, l.dailyCents - usedToday)
    limits = {
      perTip: money(l.perTipCents),
      dailyLeft: money(dailyLeft),
      minTip: money(l.minTipCents ?? 1),
      defaultTip: money(l.defaultTipCents),
    }
    const choices = tipChoices({
      minCents: l.minTipCents ?? 1,
      perTipCents: l.perTipCents,
      dailyLeftCents: dailyLeft,
      spendableCents: availableCents,
    })
    amounts = choices.amounts.map(money)
    noAmountReason = choices.reason
    // No price: no dollar figure, so no amount is known to fit.
    if (!read) {
      amounts = []
      noAmountReason = 'price'
    }
  }
  return {
    ...base,
    status: session.status === 'closing' ? 'closing' : 'ready',
    // Converted from the token at today's price: an estimate. With no price
    // there is no dollar figure, never "≈ $0.00": `exact` holds the amount.
    available: read ? convertedMoney(availableCents) : null,
    exact: {
      token: 'XLM',
      available: (left > BigInt(0) ? left : BigInt(0)).toString(),
    },
    asOf: input.asOf ?? null,
    price: priceView,
    pending: money(session.pendingCents + sendingCents),
    deviceReady: input.device === 'ready',
    limits,
    amounts,
    noAmountReason,
  }
}

function articleHref(entry: ActivityEntry): string | null {
  return entry.article.authorUsername && entry.article.slug
    ? `/${entry.article.authorUsername}/${entry.article.slug}`
    : null
}

export function activityItemOf(
  entry: ActivityEntry,
  now: number,
  lagMs: number = LAG_NOTICE_MS
): ActivityItem {
  const status =
    entry.state === 'accepted'
      ? 'sent'
      : entry.state === 'on-chain'
        ? 'on-chain'
        : 'not-paid'
  return {
    id: entry.id,
    requestId: entry.requestId,
    role: entry.role,
    counterparty: entry.counterparty,
    article: { title: entry.article.title, href: articleHref(entry) },
    passage: entry.passage,
    amount: money(entry.amountCents),
    net: money(entry.netCents),
    paid: money(entry.paidCents),
    paidNet: money(entry.paidNetCents),
    fee: money(entry.feeCents),
    unpaid: money(entry.unpaidCents),
    unpaidNet: money(entry.unpaidNetCents),
    status,
    reason: entry.notPaidReason,
    at: entry.at,
    lagging: status === 'sent' && now - entry.at > lagMs,
    txHash: entry.txHash,
    exact: entry.baseUnits,
  }
}

/** A tip of this browser the server has not answered yet. */
export function sendingItemOf(entry: OutboxEntry): ActivityItem {
  return {
    id: `sending:${entry.requestId}`,
    requestId: entry.requestId,
    role: 'reader',
    counterparty: { name: entry.meta.writerName, username: null },
    article: { title: entry.meta.articleTitle, href: entry.meta.href },
    passage: entry.passage?.text ?? null,
    amount: money(entry.amountCents),
    // Net and fee are unknown until the server accepts and prices the tip.
    net: null,
    paid: money(0),
    paidNet: money(0),
    fee: null,
    unpaid: money(entry.amountCents),
    unpaidNet: null,
    status: 'sending',
    reason: null,
    at: entry.createdAt,
    lagging: false,
    txHash: null,
    exact: null,
  }
}

/**
 * The reader's list: unanswered outbox entries first (newest first), then
 * the server's entries. An entry the server lists is never shown twice.
 */
export function readerItemsOf(input: {
  entries: ActivityEntry[]
  outbox: OutboxEntry[]
  session: SessionRead | undefined
  now: number
}): ActivityItem[] {
  const listed = new Set(input.entries.map((e) => e.requestId).filter(Boolean))
  const sending = unansweredEntries(input.outbox, input.session)
    .filter((e) => !listed.has(e.requestId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(sendingItemOf)
  return [...sending, ...input.entries.map((e) => activityItemOf(e, input.now))]
}

export function earningsViewOf(input: {
  signedIn: boolean
  earnings: EarningsRead | undefined
  /** The newest page of the writer's list, for the lag notice. */
  entries: ActivityEntry[]
  now: number
  asOf?: number | null
}): EarningsView {
  const e = input.earnings
  const empty: EarningsView = {
    status: 'loading',
    pending: null,
    available: null,
    collected: null,
    total: null,
    onHold: null,
    notPaid: null,
    counts: null,
    lagging: false,
    oldestPendingAt: null,
    exact: null,
    asOf: null,
    isWriter: null,
  }
  if (!input.signedIn || e === null) return { ...empty, status: 'signed-out' }
  if (e === undefined) return empty
  if (!e.isWriter)
    return {
      ...empty,
      status: 'none',
      isWriter: false,
      asOf: input.asOf ?? null,
    }
  return {
    status: 'ready',
    isWriter: true,
    asOf: input.asOf ?? null,
    pending: money(e.pendingCents),
    available: money(e.availableCents),
    collected: money(e.collectedCents),
    total: money(e.totalCents),
    onHold: money(e.onHoldCents),
    notPaid: money(e.notPaidCents),
    counts: {
      pending: e.pendingCount,
      onHold: e.onHoldCount,
      notPaid: e.notPaidCount,
      settled: e.settledCount,
    },
    // The oldest pending tip, from the server: no page of rows needed.
    lagging:
      e.oldestPendingAt !== null &&
      input.now - e.oldestPendingAt > LAG_NOTICE_MS,
    oldestPendingAt: e.oldestPendingAt,
    exact: {
      token: 'XLM',
      available: e.baseUnits.available,
      collected: e.baseUnits.collected,
    },
  }
}

/** A paged list's state from `usePaginatedQuery`'s status. */
export function pageState(
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
): Pick<ActivityView, 'canLoadMore' | 'loadingMore'> & {
  firstLoad: boolean
} {
  return {
    firstLoad: status === 'LoadingFirstPage',
    canLoadMore: status === 'CanLoadMore',
    loadingMore: status === 'LoadingMore',
  }
}
