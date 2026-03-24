import { describe, it, expect } from 'vitest'
import {
  TIP_MIN_CENTS,
  TIP_MIN_USD,
  TIP_MAX_CENTS,
  TIP_MAX_USD,
  MIN_WITHDRAWAL_USD,
  TIP_PRESETS_ARTICLE,
  TIP_PRESETS_HIGHLIGHT,
  EDITOR_PROSE_CLASS,
} from '../constants'

describe('constants', () => {
  it('defines correct tip limits', () => {
    expect(TIP_MIN_CENTS).toBe(1)
    expect(TIP_MIN_USD).toBe(0.01)
    expect(TIP_MAX_CENTS).toBe(10_000)
    expect(TIP_MAX_USD).toBe(100)
  })

  it('defines correct withdrawal minimum', () => {
    expect(MIN_WITHDRAWAL_USD).toBe(10)
  })

  it('defines tip presets within valid range', () => {
    for (const p of TIP_PRESETS_ARTICLE) {
      expect(p.cents).toBeGreaterThanOrEqual(TIP_MIN_CENTS)
      expect(p.cents).toBeLessThanOrEqual(TIP_MAX_CENTS)
    }
    for (const p of TIP_PRESETS_HIGHLIGHT) {
      expect(p.cents).toBeGreaterThanOrEqual(TIP_MIN_CENTS)
      expect(p.cents).toBeLessThanOrEqual(TIP_MAX_CENTS)
    }
  })

  it('EDITOR_PROSE_CLASS contains prose base classes', () => {
    expect(EDITOR_PROSE_CLASS).toContain('prose')
    expect(EDITOR_PROSE_CLASS).toContain('prose-lg')
    expect(EDITOR_PROSE_CLASS).toContain('max-w-none')
  })
})
