import { describe, it, expect } from 'vitest'
import {
  calculateTipBreakdown,
  formatTipAmount,
  getHeatmapColor,
  HEATMAP_PALETTE,
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
    const explicit = calculateTipBreakdown(
      1000,
      STELLAR_CONFIG.PLATFORM_FEE_BPS
    )
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

function channelValue(hex: string, channel: 'r' | 'g' | 'b'): number {
  const normalized = hex.replace('#', '')
  const offset = channel === 'r' ? 0 : channel === 'g' ? 2 : 4
  return parseInt(normalized.slice(offset, offset + 2), 16)
}

function relativeLuminance(hex: string): number {
  const channels = (['r', 'g', 'b'] as const).map((channel) => {
    const value = channelValue(hex, channel) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const [r, g, b] = channels
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

describe('getHeatmapColor', () => {
  it('returns the lightest palette color when max is zero', () => {
    expect(getHeatmapColor(0, 0)).toBe(HEATMAP_PALETTE[0])
  })

  it('returns darker colors as amount increases', () => {
    const low = getHeatmapColor(10, 100)
    const mid = getHeatmapColor(50, 100)
    const high = getHeatmapColor(100, 100)
    expect(relativeLuminance(low)).toBeGreaterThan(relativeLuminance(mid))
    expect(relativeLuminance(mid)).toBeGreaterThan(relativeLuminance(high))
    expect(high).toBe(HEATMAP_PALETTE[3])
  })

  it('caps intensity at max amount', () => {
    expect(getHeatmapColor(200, 100)).toBe(getHeatmapColor(100, 100))
  })
})

describe('formatTipAmount', () => {
  it('always shows two fraction digits', () => {
    expect(formatTipAmount(100)).toBe('$1.00')
    expect(formatTipAmount(1)).toBe('$0.01')
    expect(formatTipAmount(0)).toBe('$0.00')
  })
})
