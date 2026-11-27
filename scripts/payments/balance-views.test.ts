/**
 * The tip control's state machine and the view mappers
 * (`lib/payments/tip-machine.ts`, `lib/payments/views.ts`,
 * `lib/payments/money.ts`, `lib/payments/outbox.ts`): "Sent" only after
 * acceptance, one tip in flight, refusals before sending, and the
 * optimistic balance that never counts a tip twice.
 */
import { describe, expect, it } from 'vitest'
import {
  baseUnitsToCents,
  centsToBaseUnits,
  formatMoney,
  formatTokenAmount,
  approxMoney,
  money,
} from '../../lib/payments/money'
import { createOutbox, type OutboxEntry } from '../../lib/payments/outbox'
import { onJob, onTap, tipLabel } from '../../lib/payments/tip-machine'
import type { TipPhase } from '../../lib/payments/types'
import {
  balanceViewOf,
  defaultChoice,
  earningsViewOf,
  effectiveChoice,
  readerItemsOf,
  tipChoices,
  type ActivityEntry,
  type SessionRead,
} from '../../lib/payments/views'
import { centsToStroops } from '../../convex/lib/chain/tabLedger'
import { centsFromBaseUnits } from '../../convex/lib/moneyViews'

const NOW = Date.UTC(2026, 10, 27, 18, 0, 0)
const PRICE = 0.3475

function session(
  o: Partial<NonNullable<SessionRead>> = {}
): NonNullable<SessionRead> {
  return {
    userId: 'u1' as never,
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
        availableCents: baseUnitsToCents(BigInt(200_000_000), PRICE),
      },
    ],
    availableCents: baseUnitsToCents(BigInt(200_000_000), PRICE),
    pendingCents: 0,
    limits: {
      perTipCents: 500,
      dailyCents: 2000,
      acceptedDay: '2026-11-27',
      acceptedTodayCents: 0,
      minTipCents: 4,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
    },
    devices: [],
    recentRequestIds: [],
    onChain: true,
    ...o,
  } as NonNullable<SessionRead>
}

function outboxEntry(requestId: string, cents: number): OutboxEntry {
  return {
    requestId,
    userId: 'u1',
    articleId: 'a1',
    passage: { text: 'A line worth a dollar.', startOffset: 1, endOffset: 20 },
    amountCents: cents,
    estimate: centsToBaseUnits(cents, PRICE).toString(),
    createdAt: NOW - 1000,
    meta: { articleTitle: 'On Writing', writerName: 'Ada', href: null },
  }
}

const view = (s: SessionRead | undefined, outbox: OutboxEntry[] = []) =>
  balanceViewOf({
    authLoading: false,
    signedIn: true,
    session: s,
    outbox,
    device: 'ready',
    online: true,
    now: NOW,
  })

describe('money arithmetic matches the server', () => {
  it('converts cents and base units exactly as prepare and the session do', () => {
    for (const cents of [1, 4, 99, 100, 101, 333, 500])
      for (const price of [0.3475, 0.1, 1, 0.123456])
        expect(centsToBaseUnits(cents, price)).toBe(
          centsToStroops(cents, price)
        )
    for (const base of [
      BigInt(0),
      BigInt(1),
      BigInt(28_776_978),
      BigInt(10_000_000_000),
    ])
      for (const price of [0.3475, 1])
        expect(baseUnitsToCents(base, price)).toBe(
          centsFromBaseUnits(base, price)
        )
  })

  it('marks converted figures as estimates and stored ones as exact', () => {
    // Spendable is converted from the token at today's price.
    expect(view(session()).available!.display).toBe('≈ $6.95')
    expect(approxMoney(1728).display).toBe('≈ $17.28')
    // A tip's cents are stored at tip time: exact on the button and rows.
    expect(money(25).display).toBe('$0.25')
    expect(tipLabel({ phase: 'idle' }, money(25), true)).toBe(
      'Tip this line $0.25'
    )
  })

  it('shows dollars floored and the exact token amount', () => {
    expect(formatMoney(97.5)).toBe('$0.97')
    expect(formatMoney(123456)).toBe('$1,234.56')
    expect(formatTokenAmount('28776978')).toBe('2.8776978 XLM')
    expect(formatTokenAmount('10000000')).toBe('1 XLM')
    expect(formatTokenAmount('975')).toBe('0.0000975 XLM')
  })
})

describe('tip control state machine', () => {
  const ready = { online: true, available: money(695), unavailable: null }

  it('sends at once on a tap and says Sent only after acceptance', () => {
    const tap = onTap({ phase: 'idle' }, 100, ready, 'r1')
    expect(tap).toEqual({
      send: true,
      phase: { phase: 'sending', requestId: 'r1', amount: money(100) },
    })
    expect(tipLabel(tap.phase, money(100), true)).toBe('Sending $1')
    // The runtime has no answer yet: still sending.
    expect(onJob(tap.phase, { status: 'sending' })).toBe(tap.phase)
    const sent = onJob(tap.phase, { status: 'sent' })
    expect(sent).toEqual({ phase: 'sent', requestId: 'r1', amount: money(100) })
    expect(tipLabel(sent, money(100), true)).toBe('Sent $1')
  })

  it('ignores a second tap while a tip is in flight (double tap)', () => {
    const sending: TipPhase = {
      phase: 'sending',
      requestId: 'r1',
      amount: money(100),
    }
    expect(onTap(sending, 100, ready, 'r2')).toEqual({
      send: false,
      phase: sending,
    })
  })

  it('refuses offline and over the balance before anything is sent', () => {
    expect(
      onTap({ phase: 'idle' }, 100, { ...ready, online: false }, 'r1')
    ).toEqual({ send: false, phase: { phase: 'offline', amount: money(100) } })
    expect(onTap({ phase: 'idle' }, 800, ready, 'r1')).toEqual({
      send: false,
      phase: {
        phase: 'needs-funds',
        amount: money(800),
        available: money(695),
      },
    })
    expect(
      onTap({ phase: 'idle' }, 100, { ...ready, unavailable: 'device' }, 'r1')
        .send
    ).toBe(false)
  })

  it('reports a refusal as failed, with nothing charged', () => {
    const sending: TipPhase = {
      phase: 'sending',
      requestId: 'r1',
      amount: money(300),
    }
    const failed = onJob(sending, {
      status: 'failed',
      code: 'TAB_OVER_BALANCE',
    })
    expect(failed).toEqual({
      phase: 'failed',
      code: 'TAB_OVER_BALANCE',
      amount: money(300),
    })
    expect(tipLabel(failed, money(300), true)).toBe('Try again')
    // A tap after a failure sends a new tip.
    expect(onTap(failed, 300, ready, 'r2').send).toBe(true)
  })

  it('labels the article and the passage controls', () => {
    expect(tipLabel({ phase: 'idle' }, money(300), false)).toBe('Tip $3')
    expect(tipLabel({ phase: 'idle' }, money(150), true)).toBe(
      'Tip this line $1.50'
    )
  })
})

describe('optimistic balance and reconciliation', () => {
  it('takes a tip off spendable at once, and never twice once the server lists it', () => {
    const before = view(session())
    const tip = outboxEntry('r1', 100)
    const during = view(session(), [tip])
    expect(during.available!.cents).toBe(
      baseUnitsToCents(BigInt(200_000_000) - BigInt(tip.estimate), PRICE)
    )
    expect(during.pending!.cents).toBe(100)
    expect(
      before.available!.cents - during.available!.cents
    ).toBeGreaterThanOrEqual(99)
    // The server accepted: its own figures include the tip, the entry is ignored.
    const accepted = session({
      tokens: [
        {
          token: 'xlm',
          contractId: 'C',
          confirmed: '200000000',
          outstanding: tip.estimate,
          available: (BigInt(200_000_000) - BigInt(tip.estimate)).toString(),
          availableCents: 0,
        },
      ],
      pendingCents: 100,
      recentRequestIds: ['r1'],
    })
    const after = view(accepted, [tip])
    expect(after.available).toEqual(during.available)
    expect(after.pending!.cents).toBe(100)
  })

  it('offers ladder amounts within every limit, never the raw ceiling', () => {
    expect(view(session()).amounts.map((m) => m.cents)).toEqual([
      100, 200, 300, 500,
    ])
    const capped = view(
      session({
        limits: {
          perTipCents: 63, // 5 XLM at a low price
          dailyCents: 2000,
          acceptedDay: '2026-11-27',
          acceptedTodayCents: 0,
          minTipCents: 4,
          quickTipMaxCents: 500,
          defaultTipCents: 100,
        },
      })
    )
    expect(capped.amounts.map((m) => m.cents)).toEqual([10, 25, 50])
    expect(capped.noAmountReason).toBeNull()
  })

  it('lists an unanswered tip as Sending, once, until the server lists it', () => {
    const tip = outboxEntry('r1', 100)
    const sending = readerItemsOf({
      entries: [],
      outbox: [tip],
      session: session(),
      now: NOW,
    })
    expect(sending.map((i) => [i.status, i.amount.display])).toEqual([
      ['sending', '$1.00'],
    ])
    const server: ActivityEntry = {
      id: 'receipt-1',
      requestId: 'r1',
      role: 'reader',
      counterparty: { name: 'Ada', username: 'ada' },
      article: {
        title: 'On Writing',
        slug: 'on-writing',
        authorUsername: 'ada',
      },
      passage: 'A line worth a dollar.',
      amountCents: 100,
      netCents: 97,
      paidCents: 0,
      paidNetCents: 0,
      state: 'accepted',
      notPaidReason: null,
      at: NOW - 500,
      txHash: null,
      baseUnits: { token: 'XLM', gross: tip.estimate, net: '0' },
    }
    const listed = readerItemsOf({
      entries: [server],
      outbox: [tip],
      session: session(),
      now: NOW,
    })
    expect(listed.map((i) => [i.id, i.status])).toEqual([['receipt-1', 'sent']])
  })

  it('never returns a figure that was not read', () => {
    for (const v of [view(undefined), view(null)]) {
      expect(v.available).toBeNull()
      expect(v.pending).toBeNull()
      expect(v.amounts).toEqual([])
    }
    // A confirmed account with no balance is a real zero.
    expect(view(session({ status: 'none' })).available?.display).toBe('≈ $0.00')
    const loading = earningsViewOf({
      signedIn: true,
      earnings: undefined,
      entries: [],
      now: NOW,
    })
    expect(loading).toMatchObject({
      status: 'loading',
      pending: null,
      available: null,
      collected: null,
      counts: null,
    })
  })

  it('is signed out without a session and empty without a balance', () => {
    expect(view(null).status).toBe('signed-out')
    expect(view(undefined).status).toBe('loading')
    expect(view(session({ status: 'none' })).status).toBe('none')
  })
})

describe('the outbox is per user and survives a reload', () => {
  it('lists only the signed-in user’s entries, from the same storage', () => {
    const data = new Map<string, string>()
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
    const page1 = createOutbox(store)
    page1.put({ ...outboxEntry('a1', 100), userId: 'user-a' })
    page1.put({ ...outboxEntry('b1', 100), userId: 'user-b' })
    // A reload: a new outbox over the same storage.
    const page2 = createOutbox(store)
    expect(page2.list('user-a').map((e) => e.requestId)).toEqual(['a1'])
    expect(page2.list('user-b').map((e) => e.requestId)).toEqual(['b1'])
    page2.remove('a1')
    expect(createOutbox(store).list('user-a')).toEqual([])
  })

  it('falls back to memory when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    const outbox = createOutbox(blocked)
    outbox.put(outboxEntry('m1', 100))
    expect(outbox.list('u1').map((e) => e.requestId)).toEqual(['m1'])
  })
})

describe('the tip ladder', () => {
  const bounds = {
    minCents: 4,
    perTipCents: 500,
    dailyLeftCents: 2000,
    spendableCents: 10_000,
  }
  const offered = (o: Partial<typeof bounds>) => tipChoices({ ...bounds, ...o })

  it('offers the largest four that fit every bound, ascending', () => {
    expect(offered({})).toEqual({ amounts: [100, 200, 300, 500], reason: null })
    expect(offered({ perTipCents: 63 }).amounts).toEqual([10, 25, 50])
    expect(offered({ spendableCents: 30 }).amounts).toEqual([10, 25])
    expect(offered({ dailyLeftCents: 12 }).amounts).toEqual([10])
    expect(offered({ minCents: 11, perTipCents: 63 }).amounts).toEqual([25, 50])
  })

  it('says why when nothing fits, with no amount offered', () => {
    expect(offered({ perTipCents: 9 })).toEqual({ amounts: [], reason: 'cap' })
    expect(offered({ minCents: 600 })).toEqual({ amounts: [], reason: 'cap' })
    expect(offered({ dailyLeftCents: 5 })).toEqual({
      amounts: [],
      reason: 'daily',
    })
    expect(offered({ spendableCents: 9 })).toEqual({
      amounts: [],
      reason: 'balance',
    })
  })

  it('defaults to $1 when it fits, else the smallest offered amount', () => {
    expect(defaultChoice([100, 200, 300, 500])).toBe(100)
    expect(defaultChoice([10, 25, 50])).toBe(10)
    expect(defaultChoice([])).toBeNull()
  })

  it('never raises the reader’s choice as the bounds move', () => {
    const chosen = 300
    const steps = [
      { amounts: [100, 200, 300, 500], expect: 300 },
      { amounts: [10, 25, 50], expect: 50 }, // the price rose: cap 63 cents
      { amounts: [10, 25], expect: 25 }, // spendable 30 cents
      { amounts: [10], expect: 10 }, // daily remainder 12 cents
      { amounts: [25, 50], expect: 50 }, // minimum above 10 cents
      { amounts: [], expect: null }, // nothing fits
      { amounts: [100, 200, 300, 500], expect: 300 }, // larger again: stays
    ]
    for (const step of steps) {
      const shown = effectiveChoice(chosen, step.amounts)
      expect(shown).toBe(step.expect)
      if (shown !== null) expect(shown <= chosen).toBe(true)
    }
    // A reader who never chose gets the default, not the largest.
    expect(effectiveChoice(null, [10, 25, 50])).toBe(10)
    // A choice below every offered amount is not raised: none is shown.
    expect(effectiveChoice(10, [25, 50])).toBeNull()
    expect(effectiveChoice(25, [100, 200])).toBeNull()
  })
})
