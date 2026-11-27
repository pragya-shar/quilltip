// @vitest-environment happy-dom
/**
 * The fake runtime (`lib/payments/fake.ts`) for UI work without a backend:
 * every named scenario follows the live rules, and the real hooks read it
 * through `PaymentsRuntimeContext`.
 */
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useActivity } from '../../hooks/payments/useActivity'
import { useBalance } from '../../hooks/payments/useBalance'
import { useEarnings } from '../../hooks/payments/useEarnings'
import { useTip } from '../../hooks/payments/useTip'
import {
  FAKE_SCENARIOS,
  fakePayments,
  fakeRuntime,
  type FakeScenario,
} from '../../lib/payments/fake'
import { formatMoney } from '../../lib/payments/money'
import { PaymentsRuntimeContext } from '../../lib/payments/runtime'
import type { Id } from '../../convex/_generated/dataModel'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = 1_800_000_000_000

afterEach(() => {
  document.body.innerHTML = ''
})

describe('fake scenarios follow the live rules', () => {
  it('names the scenarios a UI needs', () => {
    expect([...FAKE_SCENARIOS].sort()).toEqual(
      [
        'available',
        'empty',
        'failed',
        'lagging',
        'loading',
        'offline',
        'partly-paid',
        'pending',
        'ready',
        'sending',
        'sent',
        'signed-out',
        'signed-out-dollar',
        'unavailable',
      ].sort()
    )
  })

  for (const name of FAKE_SCENARIOS) {
    it(`${name}: figures only when ready, rows as sent, totals floored once`, () => {
      const v = fakePayments(name, NOW)
      const ready = v.balance.status === 'ready'
      expect(v.balance.available === null).toBe(!ready)
      expect(v.balance.pending === null).toBe(!ready)
      if (v.balance.available)
        expect(v.balance.available.display.startsWith('≈ ')).toBe(true)
      const e = v.earnings
      for (const figure of [e.pending, e.available, e.collected, e.total])
        expect(figure === null).toBe(e.status !== 'ready')
      if (e.status === 'ready') {
        const parts = e.pending!.cents + e.available!.cents + e.collected!.cents
        expect(Math.round(parts * 10_000)).toBe(
          Math.round(e.total!.cents * 10_000)
        )
        expect(e.lagging).toBe(v.writerActivity.items.some((i) => i.lagging))
      }
      for (const i of [...v.readerActivity.items, ...v.writerActivity.items]) {
        expect(Number.isInteger(i.amount.cents)).toBe(true)
        expect(i.amount.display).toBe(formatMoney(i.amount.cents))
        expect(i.paid.cents).toBeLessThanOrEqual(i.amount.cents)
        if (i.status === 'on-chain') expect(i.txHash).not.toBeNull()
        if (i.role === 'writer') {
          expect(i.counterparty.name).toBe('A reader')
          expect(i.status).not.toBe('sending')
        }
      }
      // A tip button states its own amount only when it can tip; a
      // signed-out offer is apart from it.
      const t = v.tip
      if (!t.ready || t.unavailable) expect(t.amount).toBeNull()
      expect(t.signedOut === null).toBe(t.unavailable !== 'signed-out')
    })
  }

  it('the available scenario is the real run: three tips, $0.68 ready', () => {
    const v = fakePayments('available', NOW)
    expect(v.writerActivity.items.map((i) => i.amount.display)).toEqual([
      '$0.10',
      '$0.10',
      '$0.50',
    ])
    expect(v.writerActivity.items.map((i) => i.net.cents)).toEqual([
      9.75, 9.75, 48.75,
    ])
    expect(v.earnings.available!.display).toBe('$0.68')
  })

  it('states each phase where the scenario says', () => {
    const phase = (n: FakeScenario) => fakePayments(n, NOW).tip.state.phase
    expect(phase('sending')).toBe('sending')
    expect(phase('sent')).toBe('sent')
    expect(phase('failed')).toBe('failed')
    expect(phase('offline')).toBe('offline')
    expect(fakePayments('offline', NOW).balance.online).toBe(false)
    expect(fakePayments('lagging', NOW).earnings.lagging).toBe(true)
    expect(fakePayments('empty', NOW).earnings.available!.display).toBe('$0.00')
    expect(fakePayments('partly-paid', NOW).earnings.onHold!.cents).toBe(14.625)
  })
})

function Probe() {
  const balance = useBalance()
  const earnings = useEarnings()
  const reader = useActivity('reader')
  const tip = useTip(
    { kind: 'article', articleId: 'a' as Id<'articles'> },
    { articleTitle: 'A', writerName: 'W', href: null }
  )
  return h(
    'p',
    null,
    [
      balance.status,
      balance.available?.display ?? '-',
      earnings.available?.display ?? '-',
      String(reader.items.length),
      tip.state.phase,
    ].join('|')
  )
}

async function render(name: FakeScenario) {
  const root = document.createElement('div')
  document.body.append(root)
  await act(async () => {
    createRoot(root).render(
      h(PaymentsRuntimeContext.Provider, {
        value: fakeRuntime(name, NOW),
        children: h(Probe),
      })
    )
  })
  return root.textContent
}

describe('the real hooks read the fake runtime', () => {
  it('renders a ready, a loading and an unavailable screen', async () => {
    expect(await render('available')).toBe('ready|≈ $2.54|$0.68|3|idle')
    expect(await render('loading')).toBe('loading|-|-|0|idle')
    expect(await render('unavailable')).toBe('unavailable|-|-|0|idle')
    expect(await render('sending')).toBe('ready|≈ $2.44|$0.00|1|sending')
  })
})
