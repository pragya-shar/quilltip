/**
 * A fake payments runtime with named scenarios, for building and testing a
 * UI with no backend, no wallet and no network:
 *
 *   <PaymentsRuntimeContext.Provider value={fakeRuntime('sent')}>
 *     <YourScreen />
 *   </PaymentsRuntimeContext.Provider>
 *
 * Every hook in `hooks/payments/` reads from it. A scenario is a fixed
 * snapshot that follows the same rules as the live runtime (figures are
 * `null` unless the view is ready, converted figures carry `converted`, rows state
 * the tip as sent and the writer's exact share). `tip()`, `setAmount()`,
 * `reset()` and `loadMore()` do nothing: a scenario never changes.
 *
 * `role` picks the person: `both` (default: tips sent to another writer on
 * the reader side, tips received on the writer side), `reader` (no earnings:
 * `status: 'none'`) or `writer` (no balance: `status: 'none'`).
 *
 * The figures are the real run's (50¢, 10¢ and 10¢ tips; 68.25¢ to the
 * writer) at $0.127328 per testnet XLM.
 */
import { convertedMoney, money } from './money'
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
  Cents,
  EarningsView,
  Money,
  PaymentsRuntime,
  TipController,
  TipPhase,
  UnavailableReason,
} from './types'

export const FAKE_SCENARIOS = [
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
  'signed-out',
  'signed-out-dollar',
] as const

export type FakeScenario = (typeof FAKE_SCENARIOS)[number]
export type FakeRole = 'reader' | 'writer' | 'both'
export type FakeOptions = { now?: number; role?: FakeRole }

export type FakePayments = {
  balance: BalanceView
  tip: TipController
  readerActivity: ActivityView
  writerActivity: ActivityView
  earnings: EarningsView
}

const MIN = 60_000
const PRICE_CENTS_PER_XLM = 12.7328
const grid = (cents: Cents) => Math.round(cents * 10_000) / 10_000
const share = (cents: Cents) => grid(cents * 0.975)
const units = (cents: Cents) =>
  String(Math.max(0, Math.floor((cents * 10_000_000) / PRICE_CENTS_PER_XLM)))
const noop = () => {}

function activity(
  items: ActivityItem[],
  status: ActivityView['status'] = 'ready'
): ActivityView {
  return {
    status,
    items,
    canLoadMore: false,
    loadingMore: false,
    loadMore: noop,
  }
}

function balance(over: Partial<BalanceView>, asOf: number): BalanceView {
  const view: BalanceView = {
    status: 'ready',
    available: convertedMoney(254),
    pending: money(0),
    deviceReady: true,
    device: 'ready',
    limits: {
      perTip: money(50),
      dailyLeft: money(500),
      minTip: money(10),
      defaultTip: money(10),
    },
    amounts: [money(10), money(25), money(50)],
    noAmountReason: null,
    settlement: { enabled: true, expectedWithinMs: 80_000 },
    online: true,
    network: 'testnet',
    asOf,
    price: { perToken: money(12.73), asOf },
    ...over,
  }
  return {
    ...view,
    exact:
      over.exact !== undefined
        ? over.exact
        : view.available
          ? { token: 'XLM', available: units(view.available.cents) }
          : null,
  }
}

const LOADING_BALANCE: Partial<BalanceView> = {
  price: null,
  status: 'loading',
  available: null,
  pending: null,
  deviceReady: false,
  device: 'loading',
  limits: null,
  amounts: [],
  exact: null,
  asOf: null,
}

function earnings(over: Partial<EarningsView> = {}): EarningsView {
  return {
    status: 'ready',
    pending: money(0),
    available: money(0),
    collected: money(0),
    total: money(0),
    onHold: money(0),
    notPaid: money(0),
    counts: { pending: 0, onHold: 0, notPaid: 0, settled: 0 },
    lagging: false,
    oldestPendingAt: null,
    exact: { token: 'XLM', available: '0', collected: '0' },
    asOf: null,
    ...over,
  }
}

const NO_EARNINGS = earnings({
  status: 'loading',
  pending: null,
  available: null,
  collected: null,
  total: null,
  onHold: null,
  notPaid: null,
  counts: null,
  exact: null,
  asOf: null,
})

function tipControl(over: Partial<TipController> = {}): TipController {
  return {
    state: { phase: 'idle' },
    amount: money(10),
    blocked: null,
    amounts: [money(10), money(25), money(50)],
    setAmount: noop,
    tip: async () => {},
    reset: noop,
    ready: true,
    warming: false,
    queued: false,
    unavailable: null,
    signedOut: null,
    ...over,
  }
}

/** A signed-out visitor: no figures, an offer from public terms only. */
function signedOutViews(offer: number[], fallback: number): FakePayments {
  const amounts = offer.map(money)
  const def = offer.includes(100) ? 100 : (offer[0] ?? fallback)
  return {
    balance: balance(
      {
        ...LOADING_BALANCE,
        status: 'signed-out',
        device: 'unavailable',
      },
      0
    ),
    tip: tipControl({
      amount: null,
      amounts: [],
      unavailable: 'signed-out',
      signedOut: { signedOut: true, amount: money(def), amounts },
    }),
    readerActivity: activity([], 'loading'),
    writerActivity: activity([], 'loading'),
    earnings: { ...NO_EARNINGS, status: 'signed-out' },
  }
}

type Row = [
  cents: number,
  status: ActivityItem['status'],
  over?: Partial<ActivityItem>,
]

/** One tip. `cents` is the tip as the reader sent it. */
function item(
  role: 'reader' | 'writer',
  n: number,
  [cents, status, over = {}]: Row,
  now: number
): ActivityItem {
  const paidCents = status === 'on-chain' ? cents : 0
  const base: ActivityItem = {
    id: `${role}-${n}`,
    // Tips sent and tips received are different tips.
    requestId: role === 'reader' ? `sent-${n}` : `received-${n}`,
    role,
    counterparty:
      role === 'reader'
        ? { name: 'Wen Hsu', username: 'wen_hsu' }
        : { name: 'A reader', username: null },
    article:
      role === 'reader'
        ? { title: 'The Winter Shelf', href: '/wen_hsu/the-winter-shelf' }
        : { title: 'Leave It Overnight', href: '/theo/leave-it-overnight' },
    passage: 'Leave it overnight.',
    amount: money(cents),
    net: money(status === 'sending' ? 0 : share(cents)),
    paid: money(paidCents),
    paidNet: money(share(paidCents)),
    fee: money(0),
    unpaid: money(0),
    unpaidNet: money(0),
    status,
    reason: null,
    at: now - n * MIN,
    lagging: false,
    txHash: status === 'on-chain' ? 'ab'.repeat(32) : null,
    exact:
      status === 'sending'
        ? null
        : { token: 'XLM', gross: units(cents), net: units(share(cents)) },
    ...over,
  }
  // The same subtractions the server makes, so a surface never does.
  return {
    ...base,
    fee: money(grid(base.amount.cents - base.net.cents)),
    unpaid: money(grid(base.amount.cents - base.paid.cents)),
    unpaidNet: money(grid(base.net.cents - base.paidNet.cents)),
  }
}

/** The reader's tips sent and the writer's tips received. */
function sides(rows: Row[], now: number) {
  return {
    reader: rows.map((r, i) => item('reader', i + 1, r, now)),
    // The writer sees a tip only once the server accepted it.
    writer: rows
      .filter(([, status]) => status !== 'sending')
      .map((r, i) => item('writer', i + 1, r, now)),
  }
}

function sum(items: ActivityItem[], pick: (i: ActivityItem) => number) {
  return grid(items.reduce((s, i) => s + pick(i), 0))
}

function readyEarnings(writer: ActivityItem[], asOf: number): EarningsView {
  const of = (
    test: (i: ActivityItem) => boolean,
    pick: (i: ActivityItem) => number
  ) => sum(writer.filter(test), pick)
  const shortfall = (i: ActivityItem) =>
    i.status === 'not-paid' && i.reason === 'shortfall'
  const final = (i: ActivityItem) =>
    i.status === 'not-paid' && i.reason !== 'shortfall'
  const pending = of(
    (i) => i.status === 'sent',
    (i) => i.net.cents
  )
  // A tip paid in part: its paid part is ready, the rest on hold or not paid.
  const ready = grid(
    of(
      (i) => i.status === 'on-chain',
      (i) => i.net.cents
    ) +
      of(
        (i) => i.status === 'not-paid',
        (i) => i.paidNet.cents
      )
  )
  return earnings({
    pending: money(pending),
    available: money(ready),
    total: money(grid(pending + ready)),
    onHold: money(of(shortfall, (i) => i.unpaidNet.cents)),
    notPaid: money(of(final, (i) => i.unpaidNet.cents)),
    counts: {
      pending: writer.filter((i) => i.status === 'sent').length,
      onHold: writer.filter(shortfall).length,
      notPaid: writer.filter(final).length,
      settled: writer.filter((i) => i.status === 'on-chain').length,
    },
    lagging: writer.some((i) => i.lagging),
    oldestPendingAt: writer
      .filter((i) => i.status === 'sent')
      .reduce<
        number | null
      >((o, i) => (o === null || i.at < o ? i.at : o), null),
    exact: { token: 'XLM', available: units(ready), collected: '0' },
    asOf,
  })
}

/** Narrows a scenario to a person who only reads or only writes. */
function forRole(v: FakePayments, role: FakeRole): FakePayments {
  if (role === 'reader')
    return {
      ...v,
      writerActivity: activity([], v.writerActivity.status),
      earnings:
        v.earnings.status === 'ready'
          ? { ...NO_EARNINGS, status: 'none', asOf: v.earnings.asOf }
          : v.earnings,
    }
  if (role === 'writer')
    return {
      ...v,
      readerActivity: activity([], v.readerActivity.status),
      balance:
        v.balance.status === 'ready'
          ? balance(
              {
                status: 'none',
                available: convertedMoney(0),
                pending: money(0),
                exact: { token: 'XLM', available: '0' },
                deviceReady: false,
                device: 'needs-setup',
                limits: null,
                amounts: [],
                online: v.balance.online,
              },
              v.balance.asOf ?? 0
            )
          : v.balance,
      tip:
        v.tip.ready && !v.tip.unavailable
          ? tipControl({ unavailable: 'no-balance', amount: null, amounts: [] })
          : v.tip,
    }
  return v
}

/** The views for one scenario. */
export function fakePayments(
  name: FakeScenario,
  options: FakeOptions | number = {}
): FakePayments {
  const { now = Date.now(), role = 'both' } =
    typeof options === 'number' ? { now: options } : options
  return forRole(scenario(name, now), role)
}

function scenario(name: FakeScenario, now: number): FakePayments {
  const settled: Row[] = [
    [10, 'on-chain'],
    [10, 'on-chain'],
    [50, 'on-chain'],
  ]
  const views = (
    rows: Row[],
    over: {
      balance?: Partial<BalanceView>
      tip?: Partial<TipController>
      asOf?: number
    } = {}
  ): FakePayments => {
    const both = sides(rows, now)
    const asOf = over.asOf ?? now
    return {
      balance: balance(over.balance ?? {}, asOf),
      tip: tipControl(over.tip),
      readerActivity: activity(both.reader),
      writerActivity: activity(both.writer),
      earnings: readyEarnings(both.writer, asOf),
    }
  }
  const phase = (p: TipPhase) => ({ state: p })
  const amount: Money = money(10)

  switch (name) {
    case 'ready':
    case 'available':
      return views(settled)
    case 'sending':
      return views([[10, 'sending']], {
        balance: { available: convertedMoney(244) },
        tip: phase({ phase: 'sending', requestId: 'sent-1', amount }),
      })
    case 'sent':
      return views([[10, 'sent']], {
        balance: { available: convertedMoney(244), pending: money(10) },
        tip: phase({ phase: 'sent', requestId: 'sent-1', amount }),
      })
    case 'pending':
      return views(
        [
          [50, 'sent'],
          [10, 'on-chain'],
        ],
        { balance: { pending: money(50) } }
      )
    case 'lagging': {
      const v = views([[10, 'sent', { lagging: true, at: now - 8 * MIN }]], {
        balance: { pending: money(10) },
      })
      return v
    }
    case 'failed':
      return views(
        [
          [10, 'not-paid', { reason: 'expired' }],
          [50, 'not-paid', { reason: 'shortfall' }],
        ],
        {
          // The tip on hold still reserves the reader's balance.
          balance: { pending: money(50) },
          tip: phase({ phase: 'failed', code: 'TAB_STALE_PREPARE', amount }),
        }
      )
    case 'partly-paid': {
      const part = (reason: 'shortfall' | 'expired') => ({
        reason,
        paid: money(10),
        paidNet: money(share(10)),
      })
      return views(
        [
          [25, 'not-paid', part('shortfall')],
          [25, 'not-paid', part('expired')],
        ],
        { balance: { pending: money(15) } }
      )
    }
    case 'empty':
      return views([])
    case 'loading':
      return {
        balance: balance(LOADING_BALANCE, 0),
        tip: tipControl({ ready: false, amount: null, amounts: [] }),
        readerActivity: activity([], 'loading'),
        writerActivity: activity([], 'loading'),
        earnings: NO_EARNINGS,
      }
    case 'unavailable': {
      const reason: UnavailableReason = 'not-loaded'
      return {
        balance: balance(
          { ...LOADING_BALANCE, status: 'unavailable', device: 'unavailable' },
          0
        ),
        tip: tipControl({ unavailable: reason, amount: null, amounts: [] }),
        readerActivity: activity([], 'unavailable'),
        writerActivity: activity([], 'unavailable'),
        earnings: { ...NO_EARNINGS, status: 'unavailable' },
      }
    }
    // Today's cap is about 64 cents: 10, 25 and 50 cents, 10 by default.
    case 'signed-out':
      return signedOutViews([10, 25, 50], 10)
    // A cap of $5 or more: $1, $2, $3 and $5, $1 by default.
    case 'signed-out-dollar':
      return signedOutViews([100, 200, 300, 500], 100)
    case 'offline':
      // The last figures read, six minutes ago.
      return views(settled, {
        balance: { online: false },
        tip: phase({ phase: 'offline', amount }),
        asOf: now - 6 * MIN,
      })
  }
}

/** A runtime for `PaymentsRuntimeContext` that always reads `name`. */
export function fakeRuntime(
  name: FakeScenario,
  options: FakeOptions | number = {}
): PaymentsRuntime {
  const views = fakePayments(name, options)
  return {
    useBalance: () => views.balance,
    useTip: () => views.tip,
    useActivity: (role) =>
      role === 'reader' ? views.readerActivity : views.writerActivity,
    useEarnings: () => views.earnings,
  }
}
