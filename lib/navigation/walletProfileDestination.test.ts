import { describe, expect, it } from 'vitest'
import {
  WALLET_PROFILE_HUB_PATH,
  getDashboardWalletPath,
  getLoginRedirectPath,
  getSafeRedirectPath,
} from './walletProfileDestination'

describe('walletProfileDestination', () => {
  it('defines the wallet dashboard hub path', () => {
    expect(WALLET_PROFILE_HUB_PATH).toBe('/dashboard/wallet')
  })

  it('builds dashboard wallet path', () => {
    expect(getDashboardWalletPath()).toBe('/dashboard/wallet')
  })

  it('builds login redirect path with encoded intended path', () => {
    expect(getLoginRedirectPath('/dashboard/wallet')).toBe(
      '/login?redirect=%2Fdashboard%2Fwallet'
    )
  })

  describe('getSafeRedirectPath', () => {
    it('returns fallback when raw is empty', () => {
      expect(getSafeRedirectPath(null)).toBe('/')
      expect(getSafeRedirectPath(undefined)).toBe('/')
      expect(getSafeRedirectPath('')).toBe('/')
    })

    it('allows safe relative paths', () => {
      expect(getSafeRedirectPath('/dashboard/wallet')).toBe('/dashboard/wallet')
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
