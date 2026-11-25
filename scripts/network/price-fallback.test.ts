import { describe, expect, it } from 'vitest'

import {
  TESTNET_FALLBACK_XLM_TO_USD_RATE,
  XlmPriceUnavailableError,
  fallbackXlmPrice,
} from '../../lib/stellar/price-fallback'

describe('fallbackXlmPrice', () => {
  it('returns the practice rate on TESTNET', () => {
    expect(fallbackXlmPrice('TESTNET')).toBe(TESTNET_FALLBACK_XLM_TO_USD_RATE)
    expect(fallbackXlmPrice('TESTNET', 0.3)).toBe(0.3)
  })

  it('fails closed on MAINNET', () => {
    expect(() => fallbackXlmPrice('MAINNET')).toThrow(XlmPriceUnavailableError)
  })

  it('fails closed on any other network value', () => {
    expect(() => fallbackXlmPrice('PUBLIC')).toThrow(/no fallback rate/)
    expect(() => fallbackXlmPrice('')).toThrow(XlmPriceUnavailableError)
  })
})
