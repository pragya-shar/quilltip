import { describe, expect, it } from 'vitest'
import {
  FEATURES_SECTION_SUBHEAD,
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_SUBHEAD,
  LANDING_FAQS,
  LANDING_FEATURE_COPY,
  TRUST_BULLETS,
} from '@/lib/copy/landing-sections'
import { WRITER_FEE_PHRASE } from '@/lib/copy/launch-guide'

describe('landing-sections copy', () => {
  it('uses moves-you language in section subheads', () => {
    expect(FEATURES_SECTION_SUBHEAD).toMatch(/moves you/)
    expect(HOW_IT_WORKS_SUBHEAD).toMatch(/moves you/)
  })

  it('removes testnet from fast tips feature title', () => {
    const fastTips = LANDING_FEATURE_COPY.find((f) => f.title === 'Fast tips')
    expect(fastTips).toBeDefined()
    expect(fastTips?.description).not.toMatch(/testnet/i)
  })

  it('keeps crypto detail in expanded tip step only', () => {
    const tipStep = HOW_IT_WORKS_STEPS.find((s) => s.title === 'Tip')
    expect(tipStep?.detail).toMatch(/testnet XLM/)
    expect(HOW_IT_WORKS_SUBHEAD).not.toMatch(/testnet/i)
  })

  it('uses canonical writer fee phrase in trust bullets', () => {
    expect(TRUST_BULLETS.some((b) => b.includes(WRITER_FEE_PHRASE))).toBe(true)
  })

  it('shortens first FAQ answer', () => {
    expect(LANDING_FAQS[0]?.answer.length).toBeLessThan(200)
  })
})
