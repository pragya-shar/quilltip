import { describe, it, expect } from 'vitest'
import {
  calculateTipBreakdown,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

describe('calculateTipBreakdown', () => {
  it('splits cents with floor on platform fee and preserves total', () => {
    const { platformFee, authorShare } = calculateTipBreakdown(500, 250)
    expect(platformFee).toBe(12)
    expect(authorShare).toBe(488)
    expect(platformFee + authorShare).toBe(500)
  })

  it('uses PLATFORM_FEE_BPS when feeBps is omitted', () => {
    const explicit = calculateTipBreakdown(1000, STELLAR_CONFIG.PLATFORM_FEE_BPS)
    const implicit = calculateTipBreakdown(1000)
    expect(implicit).toEqual(explicit)
  })

  it('formats derived amounts with two decimal places', () => {
    const b = calculateTipBreakdown(255, 250)
    expect(b.platformFee).toBe(6)
    expect(b.authorShare).toBe(249)
    expect(b.platformFeeFormatted).toBe('$0.06')
    expect(b.authorShareFormatted).toBe('$2.49')
  })
})

describe('formatTipAmount', () => {
  it('always shows two fraction digits', () => {
    expect(formatTipAmount(100)).toBe('$1.00')
    expect(formatTipAmount(1)).toBe('$0.01')
    expect(formatTipAmount(0)).toBe('$0.00')
  })
})
