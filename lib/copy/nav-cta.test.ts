import { describe, expect, it } from 'vitest'
import {
  HERO_START_READING,
  HERO_START_WRITING,
  HERO_WALLET_SETUP,
  NAV_SIGN_IN,
  NAV_TRY_ON_TESTNET,
} from '@/lib/copy/nav-cta'

describe('nav-cta vocabulary', () => {
  it('exports the approved navigation labels', () => {
    expect(NAV_SIGN_IN).toBe('Sign In')
    expect(NAV_TRY_ON_TESTNET).toBe('Try on Testnet')
  })

  it('exports the approved landing hero labels', () => {
    expect(HERO_START_READING).toBe('Start Reading')
    expect(HERO_START_WRITING).toBe('Start Writing')
    expect(HERO_WALLET_SETUP).toBe('Testnet wallet setup')
  })
})
