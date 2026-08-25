import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  calculateTipBreakdown,
  formatTipAmount,
  getHeatmapColor,
  HEATMAP_GRADIENT_CSS,
  HEATMAP_PALETTE,
} from '@/lib/stellar/highlight-utils'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

const GLOBALS_CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

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

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (left, right) => right - left
  )
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

function cssBlock(css: string, selector: string): string {
  const selectorStart = css.indexOf(`${selector} {`)
  if (selectorStart === -1) return ''

  const blockStart = css.indexOf('{', selectorStart) + 1
  const blockEnd = css.indexOf('\n}', blockStart)

  return css.slice(blockStart, blockEnd)
}

function cssVariableValue(block: string, variable: string): string | undefined {
  const match = new RegExp(`${variable}:\\s*([^;]+);`).exec(block)
  return match?.[1]?.trim()
}

describe('heatmap theme tokens', () => {
  it('uses CSS variables as the single palette source for inline heatmap styles', () => {
    expect(HEATMAP_PALETTE).toEqual([
      'var(--heatmap-0)',
      'var(--heatmap-1)',
      'var(--heatmap-2)',
      'var(--heatmap-3)',
    ])
    expect(HEATMAP_GRADIENT_CSS).toBe('var(--heatmap-gradient)')
  })

  it('defines dark-mode high-intensity stops that contrast with muted tracks', () => {
    const darkBlock = cssBlock(GLOBALS_CSS, '.dark')
    const darkMuted = cssVariableValue(darkBlock, '--muted')
    const highStop = cssVariableValue(darkBlock, '--heatmap-2')
    const maxStop = cssVariableValue(darkBlock, '--heatmap-3')

    expect(darkMuted).toBeDefined()
    expect(highStop).toBeDefined()
    expect(maxStop).toBeDefined()

    expect(contrastRatio(highStop!, darkMuted!)).toBeGreaterThan(3)
    expect(contrastRatio(maxStop!, darkMuted!)).toBeGreaterThan(3)
  })
})

describe('getHeatmapColor', () => {
  it('returns the lightest palette color when max is zero', () => {
    expect(getHeatmapColor(0, 0)).toBe(HEATMAP_PALETTE[0])
  })

  it('interpolates between theme tokens as amount increases', () => {
    const low = getHeatmapColor(10, 100)
    const mid = getHeatmapColor(50, 100)
    const high = getHeatmapColor(100, 100)

    expect(low).toBe(
      'color-mix(in srgb, var(--heatmap-0) 70%, var(--heatmap-1))'
    )
    expect(mid).toBe(
      'color-mix(in srgb, var(--heatmap-1) 50%, var(--heatmap-2))'
    )
    expect(high).toBe(HEATMAP_PALETTE[3])
  })

  it('caps intensity at max amount', () => {
    expect(getHeatmapColor(200, 100)).toBe(HEATMAP_PALETTE[3])
  })
})

describe('formatTipAmount', () => {
  it('always shows two fraction digits', () => {
    expect(formatTipAmount(100)).toBe('$1.00')
    expect(formatTipAmount(1)).toBe('$0.01')
    expect(formatTipAmount(0)).toBe('$0.00')
  })
})
