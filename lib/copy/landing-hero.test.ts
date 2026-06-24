import { describe, expect, it } from 'vitest'
import {
  LANDING_HERO_HEADLINE,
  LANDING_HERO_SUBTITLE,
  LANDING_VALUE_SUBHEAD,
} from '@/lib/copy/landing-hero'

describe('landing hero copy', () => {
  it('locks approved headline and subtitle strings', () => {
    expect(LANDING_HERO_HEADLINE).toBe('Reward the words that move you')
    expect(LANDING_HERO_SUBTITLE).toBe(
      'Read published stories for free. Tip the passages that move you.'
    )
    expect(LANDING_VALUE_SUBHEAD).toBe(
      'Read for free, tip what moves you, publish and earn.'
    )
  })
})
