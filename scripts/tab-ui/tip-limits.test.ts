import { describe, expect, it } from 'vitest'

import {
  centsToStroops,
  maxCentsWithin,
} from '../../convex/lib/chain/tabLedger'
import {
  checkTabTipAmount,
  tabTipPresets,
  tabTipStroops,
  type TabTipLimits,
} from '../../lib/tab-ui/tip-limits'

const XLM = BigInt(10_000_000)
const limits = (o: Partial<TabTipLimits> = {}): TabTipLimits => ({
  tipMax: (BigInt(5) * XLM).toString(),
  dailyLimit: (BigInt(20) * XLM).toString(),
  dailyLeft: (BigInt(20) * XLM).toString(),
  minTip: '1000000',
  priceUsd: 0.13,
  tipMaxCents: maxCentsWithin(BigInt(5) * XLM, 0.13),
  ...o,
})

describe('tab tip amounts (#546)', () => {
  it('converts cents exactly as prepare does', () => {
    for (const price of [0.1, 0.13, 0.1337, 0.25, 1, 2.718281828]) {
      for (const cents of [1, 3, 25, 33, 50, 65, 99, 100, 501, 9_999]) {
        expect(tabTipStroops(cents, price)).toBe(centsToStroops(cents, price))
      }
    }
  })

  it('the largest cent amount within the maximum is the boundary prepare uses', () => {
    for (const price of [0.1, 0.13, 0.1337, 0.25, 1, 7.5]) {
      for (const max of [BigInt(1), BigInt(25_000_000), BigInt(50_000_000)]) {
        const cents = maxCentsWithin(max, price)
        if (cents > 0)
          expect(centsToStroops(cents, price)).toBeLessThanOrEqual(max)
        if (cents < 1_000_000)
          expect(centsToStroops(cents + 1, price)).toBeGreaterThan(max)
      }
    }
    // $0.13 per XLM: 65 cents is 5 XLM to the stroop; 66 cents is over.
    expect(maxCentsWithin(BigInt(5) * XLM, 0.13)).toBe(65)
    expect(maxCentsWithin(BigInt(5) * XLM, 0)).toBe(0)
  })

  it('reports the first limit an amount meets, in prepare order', () => {
    const free = (BigInt(20) * XLM).toString()
    expect(checkTabTipAmount({ cents: 65, limits: limits(), free })).toEqual({
      ok: true,
      amount: '50000000',
    })
    expect(checkTabTipAmount({ cents: 66, limits: limits(), free })).toEqual({
      ok: false,
      reason: 'above-max',
      maxCents: 65,
    })
    expect(
      checkTabTipAmount({ cents: 1, limits: limits(), free })
    ).toMatchObject({ ok: false, reason: 'below-minimum' })
    expect(
      checkTabTipAmount({
        cents: 50,
        limits: limits({ dailyLeft: '1000' }),
        free,
      })
    ).toMatchObject({ ok: false, reason: 'daily-limit', left: '1000' })
    expect(
      checkTabTipAmount({ cents: 50, limits: limits(), free: '1' })
    ).toMatchObject({ ok: false, reason: 'balance', free: '1' })
    expect(
      checkTabTipAmount({
        cents: 50,
        limits: limits(),
        free,
        key: { acceptedTotal: '10', spendLimit: '20' },
      })
    ).toMatchObject({ ok: false, reason: 'key-limit', left: '10' })
    expect(
      checkTabTipAmount({
        cents: 50,
        limits: limits({ priceUsd: null, tipMaxCents: null }),
        free,
      })
    ).toEqual({ ok: false, reason: 'no-price' })
  })

  it('never offers a preset above the maximum', () => {
    const base = [100, 200, 500]
    expect(tabTipPresets(base, 10_000)).toEqual(base)
    expect(tabTipPresets(base, 500)).toEqual(base)
    // 65 cents: $0.65 is the top preset.
    expect(tabTipPresets(base, 65, 3)).toEqual([25, 50, 65])
    // 61 cents rounds down to $0.60.
    expect(tabTipPresets(base, 61, 3)).toEqual([25, 50, 60])
    expect(tabTipPresets(base, 384, 3)).toEqual([100, 200, 380])
    expect(tabTipPresets(base, 12, 3)).toEqual([5, 10, 12])
    // Nothing fits above the minimum: the presets stay, the tab explains.
    expect(tabTipPresets(base, 2, 3)).toEqual(base)
    for (const max of [3, 7, 19, 20, 49, 99, 101, 499]) {
      const presets = tabTipPresets(base, max, 3)
      expect(presets.length).toBeGreaterThanOrEqual(1)
      expect(presets.length).toBeLessThanOrEqual(3)
      expect(Math.min(...presets)).toBeGreaterThanOrEqual(3)
      expect(Math.max(...presets)).toBeLessThanOrEqual(max)
      expect(new Set(presets).size).toBe(presets.length)
    }
  })
})
