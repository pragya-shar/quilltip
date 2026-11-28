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
import { MONEY_TEXT_SAMPLES } from '../../lib/payments/money-samples'
import { createOutbox } from '../../lib/payments/outbox'
import { articleIdOf, tipTargetOf } from '../../lib/payments/target'
import { tapOnce, tipLabel } from '../../lib/payments/tip-machine'
import type { TipPhase } from '../../lib/payments/types'
import {
  centsToBaseUnits,
  convertedMoney,
  formatMoney,
  spokenMoney,
  tipAmount,
} from '../../lib/payments/money'
import type { OutboxEntry } from '../../lib/payments/outbox'
import {
  activityItemOf,
  balanceViewOf,
  clampIntent,
  earningsViewOf,
  pageState,
  publicChoices,
  tipChoices,
  type ActivityEntry,
  type EarningsRead,
  type SessionRead,
  effectiveChoice,
  tipBlocked,
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
    expect(item.fee!.cents).toBe(0.625)
    expect(item.unpaid.cents).toBe(20)
    expect(item.unpaidNet!.cents).toBe(19.5)
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
      oldestPendingAt: null,
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
        expect(grid(i.unpaid.cents)).toBe(grid(i.amount.cents - i.paid.cents))
        if (i.status === 'sending') {
          // Unknown until the tip is accepted: never a zero figure.
          expect([i.net, i.fee, i.unpaidNet]).toEqual([null, null, null])
          continue
        }
        expect(grid(i.fee!.cents)).toBe(grid(i.amount.cents - i.net!.cents))
        expect(grid(i.unpaidNet!.cents)).toBe(
          grid(i.net!.cents - i.paidNet.cents)
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

describe('EarningsView.oldestPendingAt', () => {
  const read = (oldestPendingAt: number | null) =>
    ({
      isWriter: true,
      pendingCents: oldestPendingAt === null ? 0 : 97.5,
      availableCents: 0,
      collectedCents: 0,
      totalCents: 0,
      onHoldCents: 0,
      notPaidCents: 0,
      pendingCount: oldestPendingAt === null ? 0 : 1,
      settledCount: 0,
      onHoldCount: 0,
      notPaidCount: 0,
      oldestPendingAt,
      baseUnits: {
        token: 'XLM',
        pendingAndOnHold: '0',
        available: '0',
        collected: '0',
      },
    }) as unknown as EarningsRead
  const view = (oldest: number | null) =>
    earningsViewOf({
      signedIn: true,
      earnings: read(oldest),
      entries: [],
      now: NOW,
    })

  it('carries the oldest pending time and applies the lag rule from it', () => {
    expect(view(null)).toMatchObject({ oldestPendingAt: null, lagging: false })
    expect(view(NOW - 60_000)).toMatchObject({
      oldestPendingAt: NOW - 60_000,
      lagging: false,
    })
    expect(view(NOW - 6 * 60_000)).toMatchObject({ lagging: true })
  })

  it('is set in the fake’s pending and lagging scenarios, null elsewhere', () => {
    const lagging = fakePayments('lagging', NOW).earnings
    expect(lagging.lagging).toBe(true)
    expect(NOW - lagging.oldestPendingAt!).toBeGreaterThan(5 * 60_000)
    expect(fakePayments('pending', NOW).earnings.oldestPendingAt).toBeTypeOf(
      'number'
    )
    expect(fakePayments('available', NOW).earnings.oldestPendingAt).toBeNull()
  })
})

describe('a tip intent returning from sign-in', () => {
  it('is a ceiling: clamped to the reader’s own ladder, never raised', () => {
    // A cap near 64 cents offers 10, 25 and 50 cents.
    const ladder = tipChoices({
      minCents: 4,
      perTipCents: 63,
      dailyLeftCents: 2000,
      spendableCents: 10_000,
    }).amounts
    expect(ladder).toEqual([10, 25, 50])
    expect(clampIntent(100, ladder)).toBe(50)
    expect(clampIntent(25, ladder)).toBe(25)
    expect(clampIntent(5, ladder)).toBeNull()
    expect(clampIntent(100, [100, 200, 300, 500])).toBe(100)
  })
})

describe('the spoken form and the conversion price', () => {
  it('says money for a screen reader, "about" for a conversion', () => {
    expect(spokenMoney(1840, { converted: true })).toBe('about 18 dollars 40')
    expect(spokenMoney(1840.9, { converted: true })).toBe('about 18 dollars 40')
    expect(spokenMoney(100)).toBe('1 dollar')
    expect(spokenMoney(9.75)).toBe('9.75 cents')
    expect(spokenMoney(1)).toBe('1 cent')
    expect(convertedMoney(1840)).toMatchObject({
      display: '≈ $18.40',
      spoken: 'about 18 dollars 40',
      converted: true,
    })
  })

  it('names the price the converted balance used, to four decimals', () => {
    const v = balance(session())
    expect(v.price!.perToken).toMatchObject({
      cents: 12.73,
      display: '$0.1273',
      converted: false,
    })
    expect(v.price!.asOf).toBe(NOW)
    expect(balance(undefined).price).toBeNull()
    // The fake names it too, wherever the balance is converted.
    expect(fakePayments('ready', NOW).balance.price!.perToken.display).toBe(
      '$0.1273'
    )
    expect(fakePayments('loading', NOW).balance.price).toBeNull()
    expect(fakePayments('signed-out', NOW).balance.price).toBeNull()
  })

  it('floors the price per token, never rounding it up', () => {
    const at = (usd: number) =>
      balance({ ...session(), prices: [{ token: 'xlm', usd, at: NOW }] }).price!
        .perToken.display
    expect(at(0.12735)).toBe('$0.1273')
    expect(at(0.12739)).toBe('$0.1273')
    expect(at(0.1273)).toBe('$0.1273')
    expect(at(0.3)).toBe('$0.30')
  })

  it('shows no dollar figure for a balance when no price is known', () => {
    for (const prices of [[], [{ token: 'xlm', usd: 0, at: NOW }]]) {
      const v = balance({ ...session(), prices })
      expect(v.status).toBe('ready')
      expect(v.available).toBeNull()
      expect(v.price).toBeNull()
      // The token amount stays: 20 XLM.
      expect(v.exact).toEqual({ token: 'XLM', available: '200000000' })
      expect(v.amounts).toEqual([])
      expect(v.noAmountReason).toBe('price')
      // Tip-time figures need no price.
      expect(v.pending).toMatchObject({ cents: 0, display: '$0.00' })
    }
  })

  it('says no price as the server sends it: with no limits', () => {
    // With no price the server has no limits to convert either.
    const v = balance({ ...session(), prices: [], limits: null })
    expect(v.status).toBe('ready')
    expect(v.available).toBeNull()
    expect(v.limits).toBeNull()
    expect(v.amounts).toEqual([])
    expect(v.noAmountReason).toBe('price')
    // The tip control in the same state: blocked for the price, not
    // "choose", and no amount to send.
    const offered = v.amounts.map((a) => a.cents)
    const cents = effectiveChoice(null, offered)
    expect(cents).toBeNull()
    expect(tipBlocked(cents, offered, v.noAmountReason)).toBe('price')
  })
})

describe('the review’s contract points', () => {
  it('writes the money text samples a parsing component relies on', () => {
    for (const sample of MONEY_TEXT_SAMPLES) {
      expect(formatMoney(sample.cents, sample.format), sample.name).toBe(
        sample.text
      )
      expect(spokenMoney(sample.cents, sample.format), sample.name).toBe(
        sample.spoken
      )
      // A tip amount carries its short text: a control needs no formatter.
      if (sample.format?.short)
        expect(tipAmount(sample.cents).short, sample.name).toBe(sample.text)
    }
  })

  it('gives each amount offered, and the one chosen, its short text', () => {
    const v = balance(session())
    expect(v.amounts.map((a) => a.short)).toEqual(
      v.amounts.map((a) => formatMoney(a.cents, { short: true }))
    )
    expect(v.amounts.every((a) => a.display.includes('.'))).toBe(true)
    const tap = tapOnce(
      {},
      'c',
      100,
      {
        online: true,
        available: convertedMoney(500),
        unavailable: null,
      },
      'r1'
    )
    expect(tap.phase).toMatchObject({
      amount: { short: '$1', display: '$1.00' },
    })
    expect(tipLabel({ phase: 'idle' }, tipAmount(100), true)).toBe(
      'Tip this line $1'
    )
  })

  it('refuses a second tap synchronously: one outbox entry', () => {
    const data = new Map<string, string>()
    const outbox = createOutbox({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    })
    const phases: Record<string, TipPhase> = {}
    const check = {
      online: true,
      available: convertedMoney(500),
      unavailable: null,
    }
    const send = (requestId: string) => {
      const decision = tapOnce(phases, 'control', 100, check, requestId)
      if (decision.send)
        outbox.put({
          requestId,
          userId: 'u1',
          articleId: 'a1',
          passage: null,
          amountCents: 100,
          estimate: '7853732',
          createdAt: NOW,
          meta: { articleTitle: 'A', writerName: 'W', href: null },
        })
    }
    // Two calls in the same tick.
    send('first')
    send('second')
    expect(outbox.list('u1').map((e) => e.requestId)).toEqual(['first'])
    // A call while sending, and one just after acceptance.
    send('third')
    phases.control = {
      phase: 'sent',
      requestId: 'first',
      amount: convertedMoney(100),
    }
    send('fourth')
    expect(outbox.list('u1')).toHaveLength(1)
  })

  it('shows no balance as an exact zero, not a conversion', () => {
    const none = balance({
      ...session(),
      status: 'none',
    } as unknown as NonNullable<SessionRead>)
    expect(none).toMatchObject({ status: 'none', exact: null, price: null })
    expect(none.available).toMatchObject({ cents: 0, converted: false })
    expect(none.available!.display).toBe('$0.00')
  })

  it('carries the writer signal in every state', () => {
    for (const name of FAKE_SCENARIOS) {
      const e = fakePayments(name, NOW).earnings
      expect(e.isWriter).toBe(
        e.status === 'ready' ? true : e.status === 'none' ? false : null
      )
    }
    expect(
      fakePayments('ready', { now: NOW, role: 'reader' }).earnings.isWriter
    ).toBe(false)
  })
})

describe('the article view’s seam', () => {
  it('writes a button’s amount without ".00", a row’s with two decimals', () => {
    expect(formatMoney(100, { short: true })).toBe('$1')
    expect(formatMoney(50, { short: true })).toBe('$0.50')
    expect(formatMoney(250, { short: true })).toBe('$2.50')
    expect(formatMoney(500_000, { short: true })).toBe('$5,000')
    expect(formatMoney(9.75, { short: true })).toBe('$0.0975')
    expect(formatMoney(100, { sign: 'minus' })).toBe('−$1.00')
    expect(formatMoney(100)).toBe('$1.00')
  })

  it('reports signedOut on every controller, null when signed in', () => {
    for (const name of FAKE_SCENARIOS) {
      const tip = fakePayments(name, NOW).tip
      expect('signedOut' in tip, name).toBe(true)
      if (name.startsWith('signed-out'))
        expect(tip.signedOut, name).toMatchObject({ signedOut: true })
      else expect(tip.signedOut, name).toBeNull()
    }
  })

  it('takes an article id as a string and checks it there', () => {
    const id = 'jh7777s11fpgcd26ntb8fzy45s8k1jkb'
    expect(articleIdOf(id)).toBe(id)
    for (const bad of [
      '',
      'abc',
      id.toUpperCase(),
      `${id} `,
      'jh7777s11fpgcd26ntb8fzy45s8k1jki',
      'a'.repeat(38),
      42,
      null,
      undefined,
    ])
      expect(articleIdOf(bad), String(bad)).toBeNull()
    const passage = { text: 'A line', startOffset: 0, endOffset: 6 }
    expect(tipTargetOf(id)).toEqual({ kind: 'article', articleId: id })
    expect(tipTargetOf(id, passage)).toEqual({
      kind: 'passage',
      articleId: id,
      passage,
    })
    expect(tipTargetOf('not an id', passage)).toBeNull()
  })
})
