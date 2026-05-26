import { describe, expect, it } from 'vitest'
import {
  WALLET_PROFILE_HUB_PATH,
  getLoginRedirectPath,
  getSafeRedirectPath,
  getWalletTabPath,
} from './walletProfileDestination'

describe('walletProfileDestination', () => {
  it('defines the wallet profile hub path', () => {
    expect(WALLET_PROFILE_HUB_PATH).toBe('/profile?tab=wallet')
  })

  it('builds wallet tab path from username', () => {
    expect(getWalletTabPath('alice')).toBe('/alice?tab=wallet')
  })

  it('builds login redirect path with encoded intended path', () => {
    expect(getLoginRedirectPath('/profile?tab=wallet')).toBe(
      '/login?redirect=%2Fprofile%3Ftab%3Dwallet'
    )
  })

  describe('getSafeRedirectPath', () => {
    it('returns fallback when raw is empty', () => {
      expect(getSafeRedirectPath(null)).toBe('/')
      expect(getSafeRedirectPath(undefined)).toBe('/')
      expect(getSafeRedirectPath('')).toBe('/')
    })

    it('allows safe relative paths', () => {
      expect(getSafeRedirectPath('/profile?tab=wallet')).toBe(
        '/profile?tab=wallet'
      )
      expect(getSafeRedirectPath('/articles')).toBe('/articles')
    })

    it('rejects open redirects', () => {
      expect(getSafeRedirectPath('https://evil.com')).toBe('/')
      expect(getSafeRedirectPath('//evil.com')).toBe('/')
      expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/')
    })

    it('uses custom fallback', () => {
      expect(getSafeRedirectPath(null, '/guide')).toBe('/guide')
    })
  })
})
