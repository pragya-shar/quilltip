/**
 * The Pocket fixture's money: the twelve scenarios of pull request 561's
 * fake runtime (`lib/payments/fake.ts`, `FAKE_SCENARIOS`), with the same
 * names and the same figures (50¢, 10¢ and 10¢ tips; 97.5% to the writer),
 * plus `none`: a signed-in account the server confirmed is empty. Here the
 * fixture plays the money layer, so it writes the display text and the
 * exact formatters: figures stored at tip time exact to six decimals, the
 * reader's converted balance with two decimals and its flag. The Pocket itself never
 * formats money. Replaced by
 * `fakeRuntime` when 561 merges.
 *
 * `role` shows one side only: a person who only reads (the money layer says
 * they do not write) or only writes (it says they do).
 */
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
  EarningsView,
  Money,
} from '../../../lib/pocket/types'

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
  // Fixture extras: awkward values the screen must lay out, and a balance
  // the money layer has no price for.
  'awkward',
  'dust',
  'no-price',
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
const STROOPS = 10_000_000
const noop = () => {}

/**
 * Exact money text, the fixture standing in for the money
 * layer: exact, two decimals, up to six when there are fractions of a cent
 * ("$0.0975"), trailing zeros after the second dropped, never rounded.
 */
export function exactCents(cents: number) {
  const millionths = Math.round(Math.max(0, cents) * 10_000)
  const whole = Math.floor(millionths / 1_000_000)
  let fraction = String(millionths % 1_000_000).padStart(6, '0')
  while (fraction.length > 2 && fraction.endsWith('0'))
    fraction = fraction.slice(0, -1)
  return `$${whole.toLocaleString('en-US')}.${fraction}`
}
/** The spoken form the money layer writes: cents under a dollar ("9.75
 * cents", "1 cent"), dollars and cents from a dollar up ("1 dollar 95",
 * "2 dollars"). */
function spokenAmount(cents: number) {
  const exact = Math.round(cents * 10_000) / 10_000
  if (exact < 100) return `${exact} ${exact === 1 ? 'cent' : 'cents'}`
  const dollars = Math.floor(exact / 100)
  const rest = Math.round((exact - dollars * 100) * 10_000) / 10_000
  const word = dollars === 1 ? 'dollar' : 'dollars'
  return rest === 0 ? `${dollars} ${word}` : `${dollars} ${word} ${rest}`
}
const money = (cents: number): Money => ({
  cents,
  display: exactCents(cents),
  spoken: spokenAmount(cents),
})
/** The reader's balance, converted at today's price: the flag (the system
 * figure adds the approximate mark), two
 * decimals, floored once at the figure. */
function converted(cents: number): Money {
  const whole = Math.floor(cents + 1e-9)
  const dollars = Math.floor(whole / 100).toLocaleString('en-US')
  const rest = String(whole % 100).padStart(2, '0')
  return { cents, display: `$${dollars}.${rest}`, converted: true }
}
const share = (cents: number) => Math.round(cents * 0.975 * 10_000) / 10_000
const baseUnits = (cents: number) =>
  String(Math.floor((cents * STROOPS) / PRICE))

/** The money layer's token formatter: "0.7853732 XLM". */
export function tokenAmount(base: string) {
  const units = Number(base)
  const whole = Math.floor(units / STROOPS)
  let frac = String(units % STROOPS).padStart(7, '0')
  while (frac.endsWith('0')) frac = frac.slice(0, -1)
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
  const notPaid = status === 'not-paid'
  const sending = status === 'sending'
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
    // The layer has no share or fee for a tip it has not accepted.
    net: sending ? null : money(share(cents)),
    paid: money(paidCents),
    paidNet: money(share(paidCents)),
    status,
    reason: null,
    at: now - n * MIN,
    lagging: false,
    txHash: status === 'on-chain' ? 'ab'.repeat(32) : null,
    exact: sending
      ? null
      : {
          token: 'XLM',
          gross: baseUnits(cents),
          net: baseUnits(share(cents)),
        },
    fee: sending ? null : money(cents - share(cents)),
    unpaid: money(sending ? cents : notPaid ? cents - paidCents : 0),
    unpaidNet: sending
      ? null
      : money(notPaid ? share(cents) - share(paidCents) : 0),
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
  available: converted(254.66),
  pending: money(0),
  deviceReady: true,
  device: 'ready',
  amounts: [money(10), money(25), money(50)],
  noAmountReason: null,
  settlement: { enabled: true, expectedWithinMs: 80_000 },
  online: true,
  network: 'testnet',
  exact: { token: 'XLM', available: baseUnits(254.66) },
  price: { perToken: money(PRICE), asOf: 0 },
  ...over,
})

const LOADING_BALANCE: BalanceView = {
  ...readyBalance(),
  status: 'loading',
  available: null,
  pending: null,
  deviceReady: false,
  device: 'loading',
  amounts: [],
  exact: null,
  price: null,
}

const NO_EARNINGS: EarningsView = {
  status: 'loading',
  isWriter: null,
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

/** A writer's share; listed tips to a writer are always accepted. */
const netOf = (i: ActivityItem) => i.net?.cents ?? 0

function earningsOf(writer: ActivityItem[]): EarningsView {
  const sent = writer.filter((i) => i.status === 'sent')
  const notPaidRows = writer.filter((i) => i.status === 'not-paid')
  const held = notPaidRows.filter((i) => i.reason === 'shortfall')
  const lost = notPaidRows.filter((i) => i.reason !== 'shortfall')
  const pending = sum(sent, netOf)
  const settled = sum(
    writer.filter((i) => i.status === 'on-chain'),
    netOf
  )
  const onHold = sum(held, (i) => netOf(i) - i.paidNet.cents)
  const notPaid = sum(lost, (i) => netOf(i) - i.paidNet.cents)
  const ready = settled + sum(notPaidRows, (i) => i.paidNet.cents)
  return {
    status: 'ready',
    isWriter: true,
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
    exact: { token: 'XLM', available: baseUnits(ready), collected: '0' },
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
  const lower = { token: 'XLM' as const, available: baseUnits(244.66) }
  switch (name) {
    case 'ready':
    case 'available':
      return views(settled)
    case 'sending':
      return views(both([[10, 'sending']], now), {
        available: converted(244.66),
        exact: lower,
      })
    case 'sent':
      return views(both([[10, 'sent']], now), {
        available: converted(244.66),
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
        unpaid: money(15),
        unpaidNet: money(share(25) - share(10)),
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
    case 'awkward': {
      // A large converted balance, and a writer's share with five decimals
      // (5¢ tip, 4.875¢ share).
      const rows = both([[5, 'on-chain']], now)
      return views(rows, {
        available: converted(123_456),
        exact: { token: 'XLM', available: baseUnits(123_456) },
      })
    }
    case 'dust':
      // Held tokens worth less than a cent: the converted figure reads
      // "$0.00"; the exact token amount is one tap away.
      return views(both([], now), {
        available: converted(0.0004),
        exact: { token: 'XLM', available: '3' },
        amounts: [],
        noAmountReason: 'balance',
      })
    case 'no-price':
      // The balance is read but no price is known: no dollar value, the
      // exact token amount, and no amount to tip with.
      return views(settled, {
        available: null,
        price: null,
        amounts: [],
        noAmountReason: 'price',
      })
    case 'none':
      return views(
        { reader: [], writer: [] },
        {
          status: 'none',
          pending: money(0),
          exact: null,
          price: null,
          deviceReady: false,
          device: 'needs-setup',
          amounts: [],
          noAmountReason: 'balance',
          // The layer writes no balance as an exact zero, not a conversion.
          available: { ...money(0), converted: false },
        }
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
      return views(settled, { online: false, asOf: now - 2 * MIN })
  }
}

/** One side only. */
export function forRole(v: FixtureViews, role: Role): FixtureViews {
  if (role === 'both') return v
  const none = activity([], 'ready')
  if (role === 'reader')
    return {
      ...v,
      writer: v.writer.status === 'ready' ? none : v.writer,
      earnings:
        v.earnings.status === 'ready'
          ? { ...earningsOf([]), status: 'none', isWriter: false }
          : v.earnings,
    }
  return {
    ...v,
    reader: v.reader.status === 'ready' ? none : v.reader,
    earnings:
      v.earnings.status === 'ready'
        ? { ...v.earnings, isWriter: true }
        : v.earnings,
  }
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
