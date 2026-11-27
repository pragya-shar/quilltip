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
import { baseUnitsToCents, money } from './money'
import type { OutboxEntry } from './outbox'
import type { ActivityItem, BalanceView, EarningsView, Money } from './types'

export type SessionRead = FunctionReturnType<typeof api.balance.session>
export type ActivityEntry = FunctionReturnType<
  typeof api.activity.mine
>['page'][number]
export type EarningsRead = FunctionReturnType<typeof api.earnings.mine>

/** Pending tips older than this read as taking longer than usual. */
export const LAG_NOTICE_MS = 5 * 60 * 1000
/** The quick amounts beside the tip button, before limits. */
export const QUICK_AMOUNTS = [100, 200, 300, 500] as const

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

const ZERO_MONEY = money(0)

export function balanceViewOf(input: {
  authLoading: boolean
  signedIn: boolean
  session: SessionRead | undefined
  outbox: OutboxEntry[]
  device: DeviceState
  online: boolean
  now: number
}): BalanceView {
  const { session } = input
  const base: BalanceView = {
    status: 'loading',
    available: ZERO_MONEY,
    pending: ZERO_MONEY,
    deviceReady: false,
    device: input.device,
    limits: null,
    amounts: [],
    settlement: session?.settlement ?? {
      enabled: false,
      expectedWithinMs: LAG_NOTICE_MS,
    },
    online: input.online,
    network: 'testnet',
  }
  if (input.authLoading) return base
  if (!input.signedIn || session === null)
    return { ...base, status: 'signed-out' }
  if (session === undefined) return base
  if (session.status === 'none') return { ...base, status: 'none' }

  const price = session.prices[0]?.usd ?? 0
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
    const ceiling = Math.min(l.perTipCents, dailyLeft, l.quickTipMaxCents)
    const min = l.minTipCents ?? 1
    const quick = QUICK_AMOUNTS.filter((c) => c <= ceiling && c >= min)
    // A per-tip limit below every quick amount still offers one amount.
    amounts = (quick.length ? quick : ceiling >= min ? [ceiling] : []).map(
      money
    )
  }
  return {
    ...base,
    status: session.status === 'closing' ? 'closing' : 'ready',
    available: money(availableCents),
    pending: money(session.pendingCents + sendingCents),
    deviceReady: input.device === 'ready',
    limits,
    amounts,
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
    net: money(0),
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
}): EarningsView {
  const e = input.earnings
  const empty: EarningsView = {
    status: 'loading',
    pending: ZERO_MONEY,
    available: ZERO_MONEY,
    collected: ZERO_MONEY,
    total: ZERO_MONEY,
    onHold: ZERO_MONEY,
    notPaid: ZERO_MONEY,
    counts: { pending: 0, onHold: 0, notPaid: 0, settled: 0 },
    lagging: false,
    exact: null,
  }
  if (!input.signedIn || e === null) return { ...empty, status: 'signed-out' }
  if (e === undefined) return empty
  return {
    status: 'ready',
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
    lagging: input.entries.some(
      (entry) =>
        entry.state === 'accepted' && input.now - entry.at > LAG_NOTICE_MS
    ),
    exact: {
      token: 'XLM',
      available: e.baseUnits.available,
      collected: e.baseUnits.collected,
    },
  }
}
