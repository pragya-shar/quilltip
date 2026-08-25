import { describe, expect, it } from 'vitest'
import {
  PRODUCT_HEADLINE,
  PRODUCT_HERO_SUBTITLE,
  PRODUCT_VALUE_SUBHEAD,
  TIP_TERM,
  WALLET_GUIDE_LABEL,
  WALLET_SETUP_ACTION_LABEL,
  WRITER_FEE_PHRASE,
} from '@/lib/copy/launch-guide'

describe('launch-guide copy', () => {
  it('locks the primary product promise', () => {
    expect(PRODUCT_HEADLINE).toBe('Reward the words that move you')
    expect(PRODUCT_HERO_SUBTITLE).toBe(
      'Read published stories for free. Tip the passages that move you.'
    )
    expect(PRODUCT_VALUE_SUBHEAD).toBe(
      'Read for free, tip what moves you, publish and earn.'
    )
  })

  it('locks tipping and wallet vocabulary', () => {
    expect(TIP_TERM).toBe('tip')
    expect(WRITER_FEE_PHRASE).toBe('Writers keep 97.5% of every tip')
    expect(WALLET_GUIDE_LABEL).toBe('Wallet Guide')
    expect(WALLET_SETUP_ACTION_LABEL).toBe('Set up wallet')
  })
})
