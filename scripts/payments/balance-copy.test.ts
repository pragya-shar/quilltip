/**
 * Row wording and amounts on both screens. A row states the tip as the
 * reader sent it; its detail states exact shares, never floored; a figure
 * is floored once. Settled tips are "Added to earnings"; "Paid to your
 * wallet" is only the collected figure on the earnings screen, never a row.
 */
import { describe, expect, it } from 'vitest'
import { statusCopy } from '../../lib/payments/copy'
import {
  CONVERTED_STYLE,
  convertedMoney,
  formatMoney,
  money,
} from '../../lib/payments/money'
import { activityItemOf, type ActivityEntry } from '../../lib/payments/views'

const NOW = 1_800_000_000_000

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 'receipt-1',
    requestId: 'r1',
    role: 'writer',
    counterparty: { name: 'A reader', username: null },
    article: { title: 'Leave It Overnight', slug: 'l', authorUsername: 'theo' },
    passage: null,
    amountCents: 50,
    netCents: 48.75,
    paidCents: 0,
    paidNetCents: 0,
    feeCents: 1.25,
    unpaidCents: 50,
    unpaidNetCents: 48.75,
    state: 'accepted',
    notPaidReason: null,
    at: NOW - 1_000,
    txHash: null,
    baseUnits: { token: 'XLM', gross: '39268660', net: '38286944' },
    ...over,
  }
}

const copyOf = (over: Partial<ActivityEntry>) =>
  statusCopy(activityItemOf(entry(over), NOW))

describe('money text', () => {
  it('writes amounts exactly: two to six decimals, nothing rounded', () => {
    expect(formatMoney(100)).toBe('$1.00')
    expect(formatMoney(195)).toBe('$1.95')
    expect(formatMoney(9.75)).toBe('$0.0975')
    expect(formatMoney(292.5)).toBe('$2.925')
    expect(formatMoney(4.875)).toBe('$0.04875')
    expect(formatMoney(14.625)).toBe('$0.14625')
    expect(formatMoney(0.0001)).toBe('$0.000001')
    expect(formatMoney(123456.78)).toBe('$1,234.5678')
    expect(formatMoney(28040.75)).toBe('$280.4075')
    // A whole cent, and 9.75 cents: exact, never floored.
    expect(formatMoney(1)).toBe('$0.01')
    expect(money(9.75).display).toBe('$0.0975')
    // Below the sixth decimal: zero, with the token amount one tap away.
    expect(formatMoney(0.00001)).toBe('$0.00')
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('keeps the exact token amount on an item whose dollars read zero', () => {
    const item = activityItemOf(
      entry({
        amountCents: 0,
        netCents: 0.00001,
        feeCents: 0,
        unpaidCents: 0,
        unpaidNetCents: 0.00001,
        baseUnits: { token: 'XLM', gross: '1', net: '1' },
      }),
      NOW
    )
    expect(item.net!.display).toBe('$0.00')
    expect(item.exact).toEqual({ token: 'XLM', gross: '1', net: '1' })
  })

  it("writes a row's direction", () => {
    expect(formatMoney(100, { sign: 'minus' })).toBe('\u2212$1.00')
    expect(formatMoney(195, { sign: 'plus' })).toBe('+$1.95')
  })

  it('writes a converted figure by one style constant, either way', () => {
    // "≈" and two decimals by default; a conversion is floored to the
    // cent, never written to six decimals.
    expect(CONVERTED_STYLE).toBe('approx')
    expect(formatMoney(254.656, { converted: true })).toBe('≈ $2.54')
    expect(formatMoney(254, { converted: true, convertedStyle: 'plain' })).toBe(
      '$2.54'
    )
    expect(
      formatMoney(254, { converted: true, convertedStyle: 'approx' })
    ).toBe('≈ $2.54')
    // A figure stored at tip time is never approximate.
    expect(formatMoney(254, { convertedStyle: 'approx' })).toBe('$2.54')
    // The default is the constant, and the views use it.
    expect(convertedMoney(254)).toMatchObject({
      cents: 254,
      converted: true,
      display: formatMoney(254, {
        converted: true,
        convertedStyle: CONVERTED_STYLE,
      }),
    })
    expect(money(254).converted).toBe(false)
  })

  it('sums rows into the figure exactly', () => {
    const shares = [48.75, 9.75, 9.75]
    expect(formatMoney(shares.reduce((a, b) => a + b, 0))).toBe('$0.6825')
    const seven = Array(7).fill(9.75) as number[]
    expect(formatMoney(seven.reduce((a, b) => a + b, 0))).toBe('$0.6825')
  })
})

describe('row wording', () => {
  it('accepted: on its way for the writer, sent for the reader', () => {
    expect(copyOf({}).label).toBe('On its way')
    expect(copyOf({ role: 'reader' }).label).toBe('Sent')
  })

  it('accepted and late: taking longer, on both sides', () => {
    const late = { at: NOW - 6 * 60_000 }
    expect(copyOf(late).label).toBe('Taking longer')
    expect(copyOf({ ...late, role: 'reader' }).detail).toBe(
      'Final. It is taking longer than usual to reach the writer.'
    )
  })

  it('settled: added to earnings, never paid to the wallet', () => {
    const settled = { state: 'on-chain' as const, paidCents: 50 }
    expect(copyOf(settled)).toMatchObject({
      label: 'Added to earnings',
      detail: 'Added to your earnings, ready to withdraw.',
    })
    expect(copyOf({ ...settled, role: 'reader' })).toMatchObject({
      label: 'Added to earnings',
      detail: "Added to the writer's earnings.",
    })
  })

  it('partly paid: exact amounts in the detail', () => {
    const partial = {
      state: 'not-paid' as const,
      notPaidReason: 'shortfall' as const,
      amountCents: 25,
      netCents: 24.375,
      paidCents: 10,
      paidNetCents: 9.75,
    }
    expect(copyOf(partial)).toMatchObject({
      label: 'Paid in part',
      detail: "$0.0975 arrived. $0.14625 is waiting on the reader's balance.",
    })
    expect(copyOf({ ...partial, role: 'reader' })).toMatchObject({
      label: 'Paid in part',
      detail:
        '$0.10 was paid. $0.15 waits on your balance; add money and it goes through.',
    })
  })

  it('collected money is never a row state', () => {
    const states = ['accepted', 'on-chain', 'not-paid'] as const
    for (const state of states)
      for (const role of ['reader', 'writer'] as const) {
        const words = JSON.stringify(copyOf({ state, role }))
        expect(words).not.toContain('Paid to your wallet')
        expect(words).not.toContain('Paid to you')
      }
  })
})
