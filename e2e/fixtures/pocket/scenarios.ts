/**
 * The Pocket fixture's money: the twelve scenarios of pull request 561's
 * fake runtime (`lib/payments/fake.ts`, `FAKE_SCENARIOS`), with the same
 * names and the same figures (50¢, 10¢ and 10¢ tips; 97.5% to the writer),
 * plus `none`: a signed-in account the server confirmed is empty. Here the
 * fixture plays the money layer, so it writes the display text; the Pocket
 * itself never formats money. Replaced by `fakeRuntime` when 561 merges.
 *
 * `role` shows one side only (reader or writer), as a person who only reads
 * or only writes sees it.
 */
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
  EarningsView,
  Money,
} from '../../../components/pocket/types'

export const SCENARIOS = [
  'ready',
  'sending',
  'sent',
  'pending',
  'available',
  'lagging',
  'failed',
  'partly-paid',
  'empty',
  'loading',
  'unavailable',
  'offline',
  'none',
] as const
export type Scenario = (typeof SCENARIOS)[number]
export type Role = 'both' | 'reader' | 'writer'

export type FixtureViews = {
  balance: BalanceView
  earnings: EarningsView
  reader: ActivityView
  writer: ActivityView
}

const MIN = 60_000
const PRICE = 12.7328 // cents per XLM in the real run
const noop = () => {}

function floorCents(cents: number) {
  const whole = Math.max(0, Math.floor(cents + 1e-9))
  const dollars = Math.floor(whole / 100).toLocaleString('en-US')
  return `$${dollars}.${String(whole % 100).padStart(2, '0')}`
}
const money = (cents: number): Money => ({ cents, display: floorCents(cents) })
const approx = (cents: number): Money => ({
  cents,
  display: `≈ ${floorCents(cents)}`,
})
const share = (cents: number) => Math.round(cents * 0.975 * 10_000) / 10_000
/** "9.75¢" below a dollar, exact. */
function exactCents(cents: number) {
  const rounded = Math.round(cents * 10_000) / 10_000
  return cents < 100 ? `${rounded}¢` : `$${rounded / 100}`
}
function tokens(cents: number) {
  const base = Math.floor((cents * 10_000_000) / PRICE)
  const whole = Math.floor(base / 10_000_000)
  const frac = String(base % 10_000_000)
    .padStart(7, '0')
    .replace(/0+$/u, '')
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} XLM`
}

type Row = [
  cents: number,
  status: ActivityItem['status'],
  over?: Partial<ActivityItem>,
]

function item(
  role: 'reader' | 'writer',
  n: number,
  [cents, status, over = {}]: Row,
  now: number
): ActivityItem {
  const paidCents = over.paid?.cents ?? (status === 'on-chain' ? cents : 0)
  const reader = role === 'reader'
  const partly = status === 'not-paid' && paidCents > 0
  return {
    id: `${role}-${n}`,
    requestId: `request-${n}`,
    role,
    counterparty: reader
      ? { name: 'Theo Marsh', username: 'theo' }
      : { name: 'A reader', username: null },
    article: { title: 'Leave It Overnight', href: '/theo/leave-it-overnight' },
    passage: 'Leave it overnight.',
    amount: money(cents),
    net: money(share(cents)),
    paid: money(paidCents),
    paidNet: money(share(paidCents)),
    status,
    reason: null,
    at: now - n * MIN,
    lagging: false,
    txHash: status === 'on-chain' ? 'ab'.repeat(32) : null,
    detail:
      status === 'sending'
        ? null
        : {
            net: exactCents(share(cents)),
            fee: exactCents(cents - share(cents)),
            paid: partly
              ? exactCents(reader ? paidCents : share(paidCents))
              : null,
            unpaid: partly
              ? exactCents(
                  reader ? cents - paidCents : share(cents) - share(paidCents)
                )
              : null,
            tokenGross: tokens(cents),
          },
    ...over,
  }
}

function activity(
  items: ActivityItem[],
  status: ActivityView['status'] = 'ready'
): ActivityView {
  return { status, items, canLoadMore: false, loadMore: noop }
}

function sum(items: ActivityItem[], pick: (i: ActivityItem) => number) {
  return Math.round(items.reduce((s, i) => s + pick(i), 0) * 10_000) / 10_000
}

const readyBalance = (over: Partial<BalanceView> = {}): BalanceView => ({
  status: 'ready',
  available: approx(254.66),
  pending: money(0),
  device: 'ready',
  settlement: { enabled: true, expectedWithinMs: 80_000 },
  online: true,
  network: 'testnet',
  exact: { token: 'XLM', available: tokens(254.66) },
  ...over,
})

const LOADING_BALANCE: BalanceView = {
  ...readyBalance(),
  status: 'loading',
  available: null,
  pending: null,
  device: 'loading',
  exact: null,
}

const NO_EARNINGS: EarningsView = {
  status: 'loading',
  pending: null,
  available: null,
  collected: null,
  total: null,
  onHold: null,
  notPaid: null,
  counts: null,
  lagging: false,
  exact: null,
}

function earningsOf(writer: ActivityItem[]): EarningsView {
  const sent = writer.filter((i) => i.status === 'sent')
  const notPaidRows = writer.filter((i) => i.status === 'not-paid')
  const held = notPaidRows.filter((i) => i.reason === 'shortfall')
  const lost = notPaidRows.filter((i) => i.reason !== 'shortfall')
  const pending = sum(sent, (i) => i.net.cents)
  const settled = sum(
    writer.filter((i) => i.status === 'on-chain'),
    (i) => i.net.cents
  )
  const onHold = sum(held, (i) => i.net.cents - i.paidNet.cents)
  const notPaid = sum(lost, (i) => i.net.cents - i.paidNet.cents)
  const ready = settled + sum(notPaidRows, (i) => i.paidNet.cents)
  return {
    status: 'ready',
    pending: money(pending),
    available: money(ready),
    collected: money(0),
    total: money(pending + ready),
    onHold: money(onHold),
    notPaid: money(notPaid),
    counts: {
      pending: sent.length,
      onHold: held.length,
      notPaid: lost.length,
      settled: writer.filter((i) => i.status === 'on-chain').length,
    },
    lagging: writer.some((i) => i.lagging),
    exact: { token: 'XLM', available: tokens(ready), collected: '0 XLM' },
  }
}

/** The same tips on both sides; the writer sees a tip once it is accepted. */
function both(rows: Row[], now: number) {
  const make = (role: 'reader' | 'writer') =>
    rows
      .map((row, i) => item(role, i + 1, row, now))
      .filter((i) => role === 'reader' || i.status !== 'sending')
  return { reader: make('reader'), writer: make('writer') }
}

function views(
  rows: ReturnType<typeof both>,
  balance: Partial<BalanceView> = {}
): FixtureViews {
  return {
    balance: readyBalance(balance),
    earnings: earningsOf(rows.writer),
    reader: activity(rows.reader),
    writer: activity(rows.writer),
  }
}

export function scenario(name: Scenario, now: number): FixtureViews {
  const settled = both(
    [
      [10, 'on-chain'],
      [10, 'on-chain'],
      [50, 'on-chain'],
    ],
    now
  )
  const lower = { token: 'XLM' as const, available: tokens(244.66) }
  switch (name) {
    case 'ready':
    case 'available':
      return views(settled)
    case 'sending':
      return views(both([[10, 'sending']], now), {
        available: approx(244.66),
        exact: lower,
      })
    case 'sent':
      return views(both([[10, 'sent']], now), {
        available: approx(244.66),
        pending: money(10),
        exact: lower,
      })
    case 'pending':
      return views(
        both(
          [
            [50, 'sent'],
            [10, 'on-chain'],
          ],
          now
        ),
        { pending: money(50) }
      )
    case 'lagging': {
      const rows = both([[10, 'sent', { lagging: true }]], now)
      for (const r of [...rows.reader, ...rows.writer]) r.at = now - 8 * MIN
      return views(rows, { pending: money(10) })
    }
    case 'failed':
      return views(
        both(
          [
            [10, 'not-paid', { reason: 'expired' }],
            [50, 'not-paid', { reason: 'shortfall' }],
          ],
          now
        )
      )
    case 'partly-paid': {
      const part = (
        reason: 'shortfall' | 'expired'
      ): Partial<ActivityItem> => ({
        reason,
        paid: money(10),
        paidNet: money(share(10)),
      })
      return views(
        both(
          [
            [25, 'not-paid', part('shortfall')],
            [25, 'not-paid', part('expired')],
          ],
          now
        )
      )
    }
    case 'empty':
      return views({ reader: [], writer: [] })
    case 'none':
      return views(
        { reader: [], writer: [] },
        { status: 'none', available: money(0), pending: money(0), exact: null }
      )
    case 'loading':
      return {
        balance: LOADING_BALANCE,
        earnings: NO_EARNINGS,
        reader: activity([], 'loading'),
        writer: activity([], 'loading'),
      }
    case 'unavailable':
      return {
        balance: {
          ...LOADING_BALANCE,
          status: 'unavailable',
          device: 'unavailable',
        },
        earnings: { ...NO_EARNINGS, status: 'unavailable' },
        reader: activity([], 'unavailable'),
        writer: activity([], 'unavailable'),
      }
    case 'offline':
      return views(settled, { online: false })
  }
}

/** One side only: a person who only reads, or only writes. */
export function forRole(v: FixtureViews, role: Role): FixtureViews {
  if (role === 'both') return v
  const none = activity([], 'ready')
  if (role === 'reader')
    return {
      ...v,
      writer: v.writer.status === 'ready' ? none : v.writer,
      earnings: v.earnings.status === 'ready' ? earningsOf([]) : v.earnings,
    }
  return { ...v, reader: v.reader.status === 'ready' ? none : v.reader }
}

/** A tip someone sent from another page or device, as the server lists it. */
export function elsewhereTip(now: number): ActivityItem {
  return item(
    'reader',
    0,
    [25, 'sent', { id: 'reader-elsewhere', requestId: 'request-elsewhere' }],
    now
  )
}
