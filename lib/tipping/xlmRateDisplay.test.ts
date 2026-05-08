import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISPLAY_CACHE_TTL_MS,
  XLM_USD_TIP_RATE_STORAGE_KEY,
  formatUsdToXlmHint,
  isDisplayCacheFresh,
  readDisplayCache,
  writeDisplayCache,
} from './xlmRateDisplay'

describe('isDisplayCacheFresh', () => {
  it('returns true within TTL', () => {
    const now = 1_000_000
    expect(
      isDisplayCacheFresh(
        { priceUsd: 0.4, clientFetchedAt: now - DISPLAY_CACHE_TTL_MS + 1 },
        now
      )
    ).toBe(true)
  })

  it('returns false at or past TTL', () => {
    const now = 1_000_000
    expect(
      isDisplayCacheFresh(
        { priceUsd: 0.4, clientFetchedAt: now - DISPLAY_CACHE_TTL_MS },
        now
      )
    ).toBe(false)
    expect(
      isDisplayCacheFresh(
        { priceUsd: 0.4, clientFetchedAt: now - DISPLAY_CACHE_TTL_MS - 1 },
        now
      )
    ).toBe(false)
  })

  it('returns false for negative age (clock skew)', () => {
    const now = 1_000_000
    expect(
      isDisplayCacheFresh(
        { priceUsd: 0.4, clientFetchedAt: now + 1000 },
        now
      )
    ).toBe(false)
  })
})

describe('readDisplayCache / writeDisplayCache', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('writes and reads a valid entry', () => {
    writeDisplayCache(0.42, 99_000)
    const read = readDisplayCache()
    expect(read).toEqual({ priceUsd: 0.42, clientFetchedAt: 99_000 })
  })

  it('returns null for missing key', () => {
    expect(readDisplayCache()).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    store[XLM_USD_TIP_RATE_STORAGE_KEY] = 'not-json'
    expect(readDisplayCache()).toBeNull()
  })

  it('returns null for malformed object', () => {
    store[XLM_USD_TIP_RATE_STORAGE_KEY] = JSON.stringify({
      priceUsd: '0.4',
      clientFetchedAt: 1,
    })
    expect(readDisplayCache()).toBeNull()
  })

  it('does not write non-finite or non-positive price', () => {
    writeDisplayCache(Number.NaN, 1)
    writeDisplayCache(-1, 1)
    writeDisplayCache(0, 1)
    expect(readDisplayCache()).toBeNull()
  })
})

describe('formatUsdToXlmHint', () => {
  it('formats moderate XLM per USD with two decimals', () => {
    expect(formatUsdToXlmHint(0.5)).toBe('$1 ≈ 2.00 XLM')
  })

  it('formats small XLM per USD with four decimals', () => {
    expect(formatUsdToXlmHint(2)).toBe('$1 ≈ 0.5000 XLM')
  })

  it('formats large XLM per USD with zero decimals', () => {
    expect(formatUsdToXlmHint(0.01)).toBe('$1 ≈ 100 XLM')
  })

  it('returns empty string for invalid price', () => {
    expect(formatUsdToXlmHint(Number.NaN)).toBe('')
    expect(formatUsdToXlmHint(0)).toBe('')
    expect(formatUsdToXlmHint(-1)).toBe('')
  })
})
