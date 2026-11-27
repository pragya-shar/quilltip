import { describe, expect, it } from 'vitest'

import {
  centsToStroops,
  maxCentsWithin,
} from '../../convex/lib/chain/tabLedger'
import {
  checkTabTipAmount,
  nextLimitsChange,
  tabTipLimitsAt,
  tabTipPresets,
  tabTipStroops,
  type TabTipLimits,
} from '../../lib/tab-ui/tip-limits'

const XLM = BigInt(10_000_000)
const NOW = Date.UTC(2026, 10, 27, 15, 0, 0)
const MAX_AGE = 30 * 60 * 1000
const limits = (o: Partial<TabTipLimits> = {}): TabTipLimits => ({
  tipMax: (BigInt(5) * XLM).toString(),
  dailyLimit: (BigInt(20) * XLM).toString(),
  acceptedToday: '0',
  acceptedDay: '2026-11-27',
  minTip: '1000000',
  priceUsd: 0.13,
  priceFetchedAt: NOW,
  priceMaxAgeMs: MAX_AGE,
  tipMaxCents: maxCentsWithin(BigInt(5) * XLM, 0.13),
  ...o,
})
const free = (BigInt(20) * XLM).toString()

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
    const at = { limits: limits(), free, now: NOW }
    expect(checkTabTipAmount({ ...at, cents: 65 })).toEqual({
      ok: true,
      amount: '50000000',
    })
    expect(checkTabTipAmount({ ...at, cents: 66 })).toEqual({
      ok: false,
      reason: 'above-max',
      maxCents: 65,
    })
    expect(checkTabTipAmount({ ...at, cents: 1 })).toMatchObject({
      ok: false,
      reason: 'below-minimum',
    })
    expect(checkTabTipAmount({ ...at, cents: 50, free: '1' })).toMatchObject({
      ok: false,
      reason: 'balance',
      free: '1',
    })
    expect(
      checkTabTipAmount({
        ...at,
        cents: 50,
        key: { acceptedTotal: '10', spendLimit: '20' },
      })
    ).toMatchObject({ ok: false, reason: 'key-limit', left: '10' })
    expect(
      checkTabTipAmount({
        ...at,
        cents: 50,
        limits: limits({ priceUsd: null, priceFetchedAt: null }),
      })
    ).toEqual({ ok: false, reason: 'no-price' })
  })
})

describe("today's limit (review of #550)", () => {
  // $0.10 per XLM: 50 cents is exactly 5 XLM.
  const at = (o: Partial<TabTipLimits>, now = NOW) => ({
    // A price fetched at `now`, so only the day decides.
    limits: limits({
      priceUsd: 0.1,
      tipMaxCents: 50,
      priceFetchedAt: now,
      ...o,
    }),
    free,
    now,
  })

  it('a tip exactly equal to what is left today passes; one stroop more does not', () => {
    // 15 of 20 XLM accepted today: 5 XLM left.
    const left = { acceptedToday: (BigInt(15) * XLM).toString() }
    expect(checkTabTipAmount({ ...at(left), cents: 50 })).toEqual({
      ok: true,
      amount: '50000000',
    })
    expect(
      checkTabTipAmount({
        ...at({ acceptedToday: (BigInt(15) * XLM + BigInt(1)).toString() }),
        cents: 50,
      })
    ).toMatchObject({ ok: false, reason: 'daily-limit', left: '49999999' })
  })

  it('a new UTC day starts at zero, by the clock passed in', () => {
    const spent = { acceptedToday: (BigInt(20) * XLM).toString() }
    const beforeMidnight = Date.UTC(2026, 10, 27, 23, 59, 59, 999)
    const afterMidnight = Date.UTC(2026, 10, 28, 0, 0, 0)
    expect(
      checkTabTipAmount({ ...at(spent, beforeMidnight), cents: 10 })
    ).toMatchObject({ ok: false, reason: 'daily-limit', left: '0' })
    expect(
      checkTabTipAmount({ ...at(spent, afterMidnight), cents: 10 })
    ).toMatchObject({ ok: true })
    expect(tabTipLimitsAt(limits(spent), afterMidnight).dailyLeft).toBe(
      BigInt(20) * XLM
    )
  })

  it('a price turns stale after its maximum age, by the clock passed in', () => {
    const fresh = tabTipLimitsAt(limits(), NOW + MAX_AGE)
    expect(fresh).toMatchObject({ priceUsd: 0.13, tipMaxCents: 65 })
    const stale = tabTipLimitsAt(limits(), NOW + MAX_AGE + 1)
    expect(stale).toMatchObject({ priceUsd: null, tipMaxCents: null })
    expect(
      checkTabTipAmount({
        limits: limits(),
        free,
        now: NOW + MAX_AGE + 1,
        cents: 25,
      })
    ).toEqual({ ok: false, reason: 'no-price' })
  })

  it('knows when to check again: the price going stale, else midnight', () => {
    expect(nextLimitsChange(limits(), NOW)).toBe(NOW + MAX_AGE + 1)
    const midnight = Date.UTC(2026, 10, 28)
    const late = Date.UTC(2026, 10, 27, 23, 50)
    expect(nextLimitsChange(limits({ priceFetchedAt: late }), late)).toBe(
      midnight
    )
    expect(nextLimitsChange(limits({ priceFetchedAt: null }), NOW)).toBe(
      midnight
    )
    // Already stale: only midnight is ahead.
    expect(nextLimitsChange(limits(), NOW + MAX_AGE + 5)).toBe(midnight)
  })
})

describe('presets', () => {
  const base = [100, 200, 500]

  it('never offers a preset above the maximum', () => {
    expect(tabTipPresets(base, 10_000)).toEqual(base)
    expect(tabTipPresets(base, 500)).toEqual(base)
    expect(tabTipPresets(base, 65, 3)).toEqual([25, 50, 65])
    expect(tabTipPresets(base, 61, 3)).toEqual([25, 50, 60])
    expect(tabTipPresets(base, 384, 3)).toEqual([100, 200, 380])
    expect(tabTipPresets(base, 12, 3)).toEqual([5, 10, 12])
    // The rounded-down top would fall below the minimum: the maximum is it.
    expect(tabTipPresets(base, 22, 21)).toEqual([22])
    expect(tabTipPresets(base, 99, 99)).toEqual([99])
    expect(tabTipPresets(base, 104, 101)).toEqual([104])
    // Nothing fits: the tab can send nothing, the wallet's presets stay.
    expect(tabTipPresets(base, 2, 3)).toBeNull()
  })

  it('property: every preset lies between the minimum and the maximum', () => {
    // 105,000 cases; collected and asserted once, so the test stays fast.
    const broken: string[] = []
    for (let min = 1; min <= 150; min += 1) {
      for (let max = 1; max <= 700; max += 1) {
        const list = tabTipPresets(base, max, min)
        const at = `min ${min}, max ${max}: ${JSON.stringify(list)}`
        if (max < min) {
          if (list !== null) broken.push(at)
          continue
        }
        if (
          list === null ||
          list.length < 1 ||
          list.length > base.length ||
          new Set(list).size !== list.length ||
          list.some((c, k) => k > 0 && c <= list[k - 1]!) ||
          list.some((c) => c > max || c < min)
        ) {
          broken.push(at)
        }
      }
    }
    expect(broken).toEqual([])
  })
})
