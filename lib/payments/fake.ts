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
 * `null` unless the view is ready, converted dollars carry "≈", rows state
 * the tip as sent and the writer's exact share). `tip()`, `setAmount()`,
 * `reset()` and `loadMore()` do nothing: a scenario never changes.
 *
 * The figures are the real run's (50¢, 10¢ and 10¢ tips; 68.25¢ to the
 * writer) at $0.127328 per testnet XLM.
 */
import { approxMoney, money, readyMoney } from './money'
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
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
] as const

export type FakeScenario = (typeof FAKE_SCENARIOS)[number]

export type FakePayments = {
  balance: BalanceView
  tip: TipController
  readerActivity: ActivityView
  writerActivity: ActivityView
  earnings: EarningsView
}

const MIN = 60_000
const share = (cents: number) => Math.round(cents * 0.975 * 10_000) / 10_000
const noop = () => {}

function activity(
  items: ActivityItem[],
  status: ActivityView['status'] = 'ready'
): ActivityView {
  return { status, items, canLoadMore: false, loadMore: noop }
}

function balance(over: Partial<BalanceView> = {}): BalanceView {
  return {
    status: 'ready',
    available: approxMoney(254.66),
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
    ...over,
  }
}

const LOADING_BALANCE = balance({
  status: 'loading',
  available: null,
  pending: null,
  deviceReady: false,
  device: 'loading',
  limits: null,
  amounts: [],
})

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
    exact: { token: 'XLM', available: '0', collected: '0' },
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
    ...over,
  }
}

/** One tip as both sides see it. `cents` is the tip as the reader sent it. */
function item(
  role: 'reader' | 'writer',
  n: number,
  cents: number,
  status: ActivityItem['status'],
  now: number,
  over: Partial<ActivityItem> = {}
): ActivityItem {
  const paidCents = status === 'on-chain' ? cents : 0
  return {
    id: `${role}-${n}`,
    requestId: `request-${n}`,
    role,
    counterparty:
      role === 'reader'
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
    exact:
      status === 'sending'
        ? null
        : {
            token: 'XLM',
            gross: String(Math.floor((cents * 10_000_000) / 12.7328)),
            net: String(Math.floor((share(cents) * 10_000_000) / 12.7328)),
          },
    ...over,
  }
}

/** Both sides of the same tips, so a scenario reads the same on each. */
function both(
  rows: [
    cents: number,
    status: ActivityItem['status'],
    over?: Partial<ActivityItem>,
  ][],
  now: number
) {
  // The writer sees a tip only once the server accepted it.
  const make = (role: 'reader' | 'writer') =>
    rows
      .map(([cents, status, over], i) =>
        item(role, i + 1, cents, status, now, over)
      )
      .filter((i) => role === 'reader' || i.status !== 'sending')
  return { reader: make('reader'), writer: make('writer') }
}

function sum(items: ActivityItem[], pick: (i: ActivityItem) => number) {
  return Math.round(items.reduce((s, i) => s + pick(i), 0) * 10_000) / 10_000
}

/** The views for one scenario, at `now`. */
export function fakePayments(
  name: FakeScenario,
  now: number = Date.now()
): FakePayments {
  const settled = both(
    [
      [10, 'on-chain'],
      [10, 'on-chain'],
      [50, 'on-chain'],
    ],
    now
  )
  const readyEarnings = (
    writer: ActivityItem[],
    over: Partial<EarningsView> = {}
  ) => {
    const pending = sum(
      writer.filter((i) => i.status === 'sent'),
      (i) => i.net.cents
    )
    const available = sum(
      writer.filter((i) => i.status === 'on-chain'),
      (i) => i.net.cents
    )
    const onHold = sum(
      writer.filter((i) => i.status === 'not-paid' && i.reason === 'shortfall'),
      (i) => i.net.cents - i.paidNet.cents
    )
    const notPaid = sum(
      writer.filter((i) => i.status === 'not-paid' && i.reason !== 'shortfall'),
      (i) => i.net.cents - i.paidNet.cents
    )
    const paidPart = sum(
      writer.filter((i) => i.status === 'not-paid'),
      (i) => i.paidNet.cents
    )
    const ready = available + paidPart
    const units = String(Math.floor((ready * 10_000_000) / 12.7328))
    return earnings({
      pending: money(pending),
      available: readyMoney(ready, units),
      total: money(pending + ready),
      onHold: money(onHold),
      notPaid: money(notPaid),
      counts: {
        pending: writer.filter((i) => i.status === 'sent').length,
        onHold: writer.filter((i) => i.reason === 'shortfall').length,
        notPaid: writer.filter(
          (i) => i.status === 'not-paid' && i.reason !== 'shortfall'
        ).length,
        settled: writer.filter((i) => i.status === 'on-chain').length,
      },
      lagging: writer.some((i) => i.lagging),
      exact: { token: 'XLM', available: units, collected: '0' },
      ...over,
    })
  }
  const views = (
    rows: ReturnType<typeof both>,
    over: { balance?: Partial<BalanceView>; tip?: Partial<TipController> } = {}
  ): FakePayments => ({
    balance: balance(over.balance),
    tip: tipControl(over.tip),
    readerActivity: activity(rows.reader),
    writerActivity: activity(rows.writer),
    earnings: readyEarnings(rows.writer),
  })
  const phase = (p: TipPhase) => ({ state: p })
  const amount: Money = money(10)

  switch (name) {
    case 'ready':
      return views(settled)
    case 'sending': {
      const rows = both([[10, 'sending']], now)
      return views(rows, {
        balance: { available: approxMoney(244.66) },
        tip: phase({ phase: 'sending', requestId: 'request-1', amount }),
      })
    }
    case 'sent':
      return views(both([[10, 'sent']], now), {
        balance: { available: approxMoney(244.66), pending: money(10) },
        tip: phase({ phase: 'sent', requestId: 'request-1', amount }),
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
        { balance: { pending: money(50) } }
      )
    case 'available':
      return views(settled)
    case 'lagging': {
      const rows = both([[10, 'sent', { lagging: true }]], now)
      for (const r of [...rows.reader, ...rows.writer]) r.at = now - 8 * MIN
      return views(rows, { balance: { pending: money(10) } })
    }
    case 'failed':
      return views(
        both(
          [
            [10, 'not-paid', { reason: 'expired' }],
            [50, 'not-paid', { reason: 'shortfall' }],
          ],
          now
        ),
        {
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
    case 'loading':
      return {
        balance: LOADING_BALANCE,
        tip: tipControl({ ready: false, amount: null, amounts: [] }),
        readerActivity: activity([], 'loading'),
        writerActivity: activity([], 'loading'),
        earnings: NO_EARNINGS,
      }
    case 'unavailable': {
      const reason: UnavailableReason = 'not-loaded'
      return {
        balance: {
          ...LOADING_BALANCE,
          status: 'unavailable',
          device: 'unavailable',
        },
        tip: tipControl({ unavailable: reason, amount: null, amounts: [] }),
        readerActivity: activity([], 'unavailable'),
        writerActivity: activity([], 'unavailable'),
        earnings: { ...NO_EARNINGS, status: 'unavailable' },
      }
    }
    case 'offline':
      return views(settled, {
        balance: { online: false },
        tip: phase({ phase: 'offline', amount }),
      })
  }
}

/** A runtime for `PaymentsRuntimeContext` that always reads `name`. */
export function fakeRuntime(
  name: FakeScenario,
  now: number = Date.now()
): PaymentsRuntime {
  const views = fakePayments(name, now)
  return {
    useBalance: () => views.balance,
    useTip: () => views.tip,
    useActivity: (role) =>
      role === 'reader' ? views.readerActivity : views.writerActivity,
    useEarnings: () => views.earnings,
  }
}
