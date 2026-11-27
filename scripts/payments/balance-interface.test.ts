// @vitest-environment happy-dom
/**
 * The interface additions a UI built on the hooks reads (`lib/payments/
 * README.md`): the exact token amount of spendable, a tip's fee and unpaid
 * parts, earnings for someone who is not a writer, a further page loading,
 * the age of the figures, and the fake runtime's role option.
 */
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAsOf } from '../../components/payments/useAsOf'
import { FAKE_SCENARIOS, fakePayments } from '../../lib/payments/fake'
import { centsToBaseUnits } from '../../lib/payments/money'
import type { OutboxEntry } from '../../lib/payments/outbox'
import {
  activityItemOf,
  balanceViewOf,
  earningsViewOf,
  pageState,
  publicChoices,
  type ActivityEntry,
  type EarningsRead,
  type SessionRead,
} from '../../lib/payments/views'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0)
const PRICE = 0.127328

afterEach(() => {
  document.body.innerHTML = ''
})

function session(): NonNullable<SessionRead> {
  return {
    userId: 'u1',
    accountAddress: 'GREADER',
    network: 'testnet',
    wallet: { address: 'GREADER', verifiedAt: 1 },
    prices: [{ token: 'xlm', usd: PRICE, at: NOW }],
    ledger: { sequence: 100, closedAt: NOW },
    settlement: { enabled: true, expectedWithinMs: 75_000 },
    status: 'open',
    tokens: [
      {
        token: 'xlm',
        contractId: 'C',
        confirmed: '200000000',
        outstanding: '0',
        available: '200000000',
        availableCents: 254,
      },
    ],
    availableCents: 254,
    pendingCents: 0,
    limits: {
      perTipCents: 50,
      dailyCents: 500,
      acceptedDay: '2026-11-28',
      acceptedTodayCents: 0,
      minTipCents: 10,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
    },
    devices: [],
    recentRequestIds: [],
    onChain: true,
  } as unknown as NonNullable<SessionRead>
}

const balance = (s: SessionRead | undefined, outbox: OutboxEntry[] = []) =>
  balanceViewOf({
    authLoading: false,
    signedIn: true,
    session: s,
    outbox,
    device: 'ready',
    online: true,
    now: NOW,
    asOf: NOW - 1000,
  })

describe('BalanceView.exact and asOf', () => {
  it('states spendable exactly in token units, net of this device’s unanswered tips', () => {
    expect(balance(session()).exact).toEqual({
      token: 'XLM',
      available: '200000000',
    })
    const sending: OutboxEntry = {
      requestId: 'r1',
      userId: 'u1',
      articleId: 'a1',
      passage: null,
      amountCents: 10,
      estimate: centsToBaseUnits(10, PRICE).toString(),
      createdAt: NOW,
      meta: { articleTitle: 'A', writerName: 'W', href: null },
    }
    expect(balance(session(), [sending]).exact!.available).toBe(
      (BigInt(200_000_000) - BigInt(sending.estimate)).toString()
    )
    expect(balance(session()).asOf).toBe(NOW - 1000)
    expect(balance(undefined)).toMatchObject({ exact: null, asOf: null })
  })
})

describe('ActivityItem.fee, unpaid and unpaidNet', () => {
  it('carries the server’s figures, so no surface subtracts', () => {
    const entry: ActivityEntry = {
      id: 'r1',
      requestId: 'q1',
      role: 'writer',
      counterparty: { name: 'A reader', username: null },
      article: { title: 'A', slug: 'a', authorUsername: 'w' },
      passage: null,
      amountCents: 25,
      netCents: 24.375,
      paidCents: 5,
      paidNetCents: 4.875,
      feeCents: 0.625,
      unpaidCents: 20,
      unpaidNetCents: 19.5,
      state: 'not-paid',
      notPaidReason: 'shortfall',
      at: NOW,
      txHash: null,
      baseUnits: { token: 'XLM', gross: '2500000', net: '2437500' },
    }
    const item = activityItemOf(entry, NOW)
    expect(item.fee.cents).toBe(0.625)
    expect(item.unpaid.cents).toBe(20)
    expect(item.unpaidNet.cents).toBe(19.5)
  })
})

describe('EarningsView for someone who is not a writer', () => {
  const read = (isWriter: boolean) =>
    ({
      isWriter,
      pendingCents: 0,
      availableCents: 0,
      collectedCents: 0,
      totalCents: 0,
      onHoldCents: 0,
      notPaidCents: 0,
      pendingCount: 0,
      settledCount: 0,
      onHoldCount: 0,
      notPaidCount: 0,
      baseUnits: {
        token: 'XLM',
        pendingAndOnHold: '0',
        available: '0',
        collected: '0',
      },
    }) as unknown as EarningsRead
  const view = (isWriter: boolean) =>
    earningsViewOf({
      signedIn: true,
      earnings: read(isWriter),
      entries: [],
      now: NOW,
      asOf: NOW,
    })

  it('is none, with no figures, not ready with zeros', () => {
    expect(view(false)).toMatchObject({
      status: 'none',
      available: null,
      pending: null,
      collected: null,
      counts: null,
    })
    expect(view(true)).toMatchObject({ status: 'ready', asOf: NOW })
    expect(view(true).available!.display).toBe('$0.00')
  })
})

describe('ActivityView.loadingMore', () => {
  it('tells a further page apart from the first load', () => {
    expect(pageState('LoadingFirstPage')).toEqual({
      firstLoad: true,
      canLoadMore: false,
      loadingMore: false,
    })
    expect(pageState('LoadingMore')).toEqual({
      firstLoad: false,
      canLoadMore: false,
      loadingMore: true,
    })
    expect(pageState('CanLoadMore').canLoadMore).toBe(true)
    expect(pageState('Exhausted')).toEqual({
      firstLoad: false,
      canLoadMore: false,
      loadingMore: false,
    })
  })
})

describe('useAsOf', () => {
  it('follows the clock while current and stops when not', async () => {
    const seen: (number | null)[] = []
    function Probe({ current, now }: { current: boolean; now: number }) {
      seen.push(useAsOf(current, now))
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(h(Probe, { current: false, now: 1 })))
    expect(seen.at(-1)).toBe(null)
    await act(async () => root.render(h(Probe, { current: true, now: 2 })))
    expect(seen.at(-1)).toBe(2)
    await act(async () => root.render(h(Probe, { current: true, now: 3 })))
    expect(seen.at(-1)).toBe(3)
    // Offline: the figures stay as old as the last answer.
    await act(async () => root.render(h(Probe, { current: false, now: 9 })))
    expect(seen.at(-1)).toBe(3)
  })
})

describe('the fake runtime by role', () => {
  it('shows a reader with no earnings and a writer with no balance', () => {
    for (const name of FAKE_SCENARIOS) {
      const reader = fakePayments(name, { now: NOW, role: 'reader' })
      expect(reader.writerActivity.items).toEqual([])
      if (fakePayments(name, NOW).earnings.status === 'ready')
        expect(reader.earnings).toMatchObject({
          status: 'none',
          available: null,
        })
      const writer = fakePayments(name, { now: NOW, role: 'writer' })
      expect(writer.readerActivity.items).toEqual([])
      if (fakePayments(name, NOW).balance.status === 'ready') {
        expect(writer.balance.status).toBe('none')
        expect(writer.tip.unavailable).toBe('no-balance')
      }
    }
  })

  it('gives a person who is both different tips on each side', () => {
    const both = fakePayments('available', { now: NOW, role: 'both' })
    const sent = new Set(both.readerActivity.items.map((i) => i.requestId))
    expect(both.writerActivity.items.some((i) => sent.has(i.requestId))).toBe(
      false
    )
    expect(both.readerActivity.items[0]!.counterparty.name).not.toBe('A reader')
  })

  it('states the new fields in every scenario', () => {
    for (const name of FAKE_SCENARIOS) {
      const v = fakePayments(name, NOW)
      for (const i of [...v.readerActivity.items, ...v.writerActivity.items]) {
        const grid = (n: number) => Math.round(n * 10_000)
        expect(grid(i.fee.cents)).toBe(grid(i.amount.cents - i.net.cents))
        expect(grid(i.unpaid.cents)).toBe(grid(i.amount.cents - i.paid.cents))
        expect(grid(i.unpaidNet.cents)).toBe(
          grid(i.net.cents - i.paidNet.cents)
        )
      }
      expect(v.readerActivity.loadingMore).toBe(false)
      const ready = v.balance.status === 'ready'
      expect(v.balance.exact === null).toBe(!ready)
      expect(v.balance.asOf === null).toBe(!ready)
    }
    const offline = fakePayments('offline', NOW)
    expect(offline.balance.asOf).toBeLessThan(NOW)
    expect(offline.earnings.asOf).toBeLessThan(NOW)
  })
})

describe('a signed-out visitor’s offer', () => {
  it('comes from public terms only and never as a balance', () => {
    const low = fakePayments('signed-out', NOW)
    expect(low.balance).toMatchObject({
      status: 'signed-out',
      available: null,
      exact: null,
    })
    expect(low.tip).toMatchObject({
      unavailable: 'signed-out',
      amount: null,
      amounts: [],
    })
    expect(low.tip.signedOut!.amounts.map((a) => a.display)).toEqual([
      '$0.10',
      '$0.25',
      '$0.50',
    ])
    expect(low.tip.signedOut!.amount.display).toBe('$0.10')
    const high = fakePayments('signed-out-dollar', NOW)
    expect(high.tip.signedOut!.amount.display).toBe('$1.00')
    // Signed in, the offer is gone: the person's own amounts are the fields.
    expect(fakePayments('ready', NOW).tip.signedOut).toBeNull()
  })

  it('offers the ladder within the public minimum and cap', () => {
    const terms = (perTipCents: number, minTipCents: number | null) => ({
      perTipCents,
      minTipCents,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
      priceUsd: 0.127,
    })
    expect(publicChoices(terms(63, 4))).toEqual([10, 25, 50])
    expect(publicChoices(terms(500, 4))).toEqual([100, 200, 300, 500])
    expect(publicChoices(terms(5_000, 4))).toEqual([100, 200, 300, 500])
    expect(publicChoices(terms(8, 4))).toEqual([])
    expect(publicChoices(null)).toEqual([])
    expect(publicChoices(undefined)).toEqual([])
  })
})
