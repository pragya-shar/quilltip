/**
 * Row wording and amounts on both screens. A row states the tip as the
 * reader sent it; its detail states exact shares, never floored; a figure
 * is floored once. Settled tips are "Added to earnings"; "Paid to your
 * wallet" is only the collected figure on the earnings screen, never a row.
 */
import { describe, expect, it } from 'vitest'
import { statusCopy } from '../../lib/payments/copy'
import { formatExactCents, formatMoney } from '../../lib/payments/money'
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

describe('exact amounts', () => {
  it('formats exact shares without flooring', () => {
    expect(formatExactCents(48.75)).toBe('48.75¢')
    expect(formatExactCents(9.75)).toBe('9.75¢')
    expect(formatExactCents(14.625)).toBe('14.625¢')
    expect(formatExactCents(10)).toBe('10¢')
    expect(formatExactCents(0.0001)).toBe('0.0001¢')
    expect(formatExactCents(100)).toBe('$1.00')
    expect(formatExactCents(487.5)).toBe('$4.875')
    expect(formatExactCents(123456.78)).toBe('$1,234.5678')
  })

  it('floors a total once; flooring each row first would show less', () => {
    const shares = [48.75, 9.75, 9.75]
    const total = shares.reduce((a, b) => a + b, 0)
    expect(formatMoney(total)).toBe('$0.68')
    const seven = Array(7).fill(9.75) as number[]
    const exact = seven.reduce((a, b) => a + b, 0)
    const flooredRows = seven.reduce((a, b) => a + Math.floor(b), 0)
    expect(formatMoney(exact)).toBe('$0.68')
    expect(formatMoney(flooredRows)).toBe('$0.63')
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
      detail: "9.75¢ arrived. 14.625¢ is waiting on the reader's balance.",
    })
    expect(copyOf({ ...partial, role: 'reader' })).toMatchObject({
      label: 'Paid in part',
      detail:
        '10¢ was paid. 15¢ waits on your balance; add money and it goes through.',
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
