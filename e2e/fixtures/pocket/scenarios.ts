/**
 * The balance fixture's money: the money layer's own fake scenarios
 * (`lib/payments/fake.ts`, `fakePayments`) and its own money writers
 * (`lib/payments/money.ts`), so the fixture says exactly what the layer
 * says and cannot drift from it. Four extras the fake does not have:
 * - `none`: signed in, the server confirmed no balance (an exact $0.00);
 * - `awkward`: a large converted balance and a share with five decimals;
 * - `dust`: held tokens worth less than a cent;
 * - `no-price`: the balance is read but no price is known.
 *
 * `role` shows one side only, as the fake's own option does.
 */
import {
  FAKE_SCENARIOS,
  fakePayments,
  type FakeRole,
} from '../../../lib/payments/fake'
import {
  convertedMoney,
  formatMoney,
  formatTokenAmount,
  money,
} from '../../../lib/payments/money'
import type {
  ActivityItem,
  ActivityView,
  BalanceView,
  EarningsView,
} from '../../../lib/payments/types'

const EXTRAS = ['none', 'awkward', 'dust', 'no-price'] as const
/** The fake's scenarios that render a signed-in balance, then the extras. */
export const SCENARIOS = [
  ...FAKE_SCENARIOS.filter((name) => !name.startsWith('signed-out')),
  ...EXTRAS,
] as const
export type Scenario = (typeof SCENARIOS)[number]
export type Role = FakeRole

export type FixtureViews = {
  balance: BalanceView
  earnings: EarningsView
  reader: ActivityView
  writer: ActivityView
}

/** The money layer's exact text and token formatter, for `format`. */
export const exactCents = (cents: number) => formatMoney(cents)
export const tokenAmount = formatTokenAmount

const PRICE_CENTS_PER_XLM = 12.7328
const baseUnits = (cents: number) =>
  String(Math.floor((cents * 10_000_000) / PRICE_CENTS_PER_XLM))

function fromFake(
  name: (typeof FAKE_SCENARIOS)[number],
  now: number,
  role: Role
): FixtureViews {
  const v = fakePayments(name, { now, role })
  return {
    balance: v.balance,
    earnings: v.earnings,
    reader: v.readerActivity,
    writer: v.writerActivity,
  }
}

export function scenario(
  name: Scenario,
  now: number,
  role: Role = 'both'
): FixtureViews {
  switch (name) {
    case 'none': {
      const v = fromFake('empty', now, role)
      return {
        ...v,
        balance: {
          ...v.balance,
          status: 'none',
          // No balance is held: an exact zero, not a conversion.
          available: money(0),
          pending: money(0),
          exact: null,
          price: null,
          deviceReady: false,
          device: 'needs-setup',
          limits: null,
          amounts: [],
          noAmountReason: null,
        },
      }
    }
    case 'awkward': {
      // A large converted balance, and a writer's share with five decimals
      // (a 5¢ tip, a 4.875¢ share).
      const v = fromFake('ready', now, role)
      const tip = (i: ActivityItem): ActivityItem => ({
        ...i,
        amount: money(5),
        net: money(4.875),
        paid: money(5),
        paidNet: money(4.875),
        fee: money(0.125),
        unpaid: money(0),
        unpaidNet: money(0),
      })
      return {
        ...v,
        balance: {
          ...v.balance,
          available: convertedMoney(123_456),
          exact: { token: 'XLM', available: baseUnits(123_456) },
        },
        reader: { ...v.reader, items: v.reader.items.slice(0, 1).map(tip) },
        writer: { ...v.writer, items: v.writer.items.slice(0, 1).map(tip) },
      }
    }
    case 'dust': {
      // Held tokens worth less than a cent: the converted figure reads
      // "$0.00"; the exact token amount is one tap away.
      const v = fromFake('empty', now, role)
      return {
        ...v,
        balance: {
          ...v.balance,
          available: convertedMoney(0.0004),
          exact: { token: 'XLM', available: '3' },
          amounts: [],
          noAmountReason: 'balance',
        },
      }
    }
    case 'no-price': {
      // The balance is read, no price is known: no dollar value, the exact
      // token amount, no amount to tip with (as `balanceViewOf` writes it).
      const v = fromFake('ready', now, role)
      return {
        ...v,
        balance: {
          ...v.balance,
          available: null,
          price: null,
          limits: null,
          amounts: [],
          noAmountReason: 'price',
        },
      }
    }
    default:
      return fromFake(name, now, role)
  }
}

/** A 25¢ tip sent from another page or device, as the server lists it. */
export function elsewhereTip(now: number): ActivityItem {
  const sent = fakePayments('sent', { now }).readerActivity.items[0]!
  return {
    ...sent,
    id: 'reader-elsewhere',
    requestId: 'request-elsewhere',
    amount: money(25),
    net: money(24.375),
    fee: money(0.625),
    unpaid: money(25),
    unpaidNet: money(24.375),
    exact: { token: 'XLM', gross: baseUnits(25), net: baseUnits(24.375) },
    at: now,
  }
}
