import { describe, expect, it } from 'vitest'
import {
  appendNextToAuthPath,
  buildGenericProfilePath,
  buildLoginRedirectPath,
  buildPathWithSearch,
  parseSafeNextParam,
  resolveSignedInProfilePath,
} from './profileDestination'

describe('buildGenericProfilePath', () => {
  it('returns /profile without tab', () => {
    expect(buildGenericProfilePath()).toBe('/profile')
    expect(buildGenericProfilePath('articles')).toBe('/profile')
  })

  it('includes tab query for nfts', () => {
    expect(buildGenericProfilePath('nfts')).toBe('/profile?tab=nfts')
  })

  it('routes legacy creator tabs to dashboard', () => {
    expect(buildGenericProfilePath('wallet')).toBe('/dashboard/wallet')
    expect(buildGenericProfilePath('earnings')).toBe('/dashboard/stats')
    expect(buildGenericProfilePath('stats')).toBe('/dashboard/stats')
  })
})

describe('resolveSignedInProfilePath', () => {
  it('returns username path without tab by default', () => {
    expect(resolveSignedInProfilePath('alice', new URLSearchParams())).toBe(
      '/alice'
    )
  })

  it('maps legacy wallet tab to dashboard', () => {
    expect(
      resolveSignedInProfilePath('alice', new URLSearchParams('tab=wallet'))
    ).toBe('/dashboard/wallet')
  })

  it('maps legacy earnings tab to dashboard stats', () => {
    expect(
      resolveSignedInProfilePath('alice', new URLSearchParams('tab=earnings'))
    ).toBe('/dashboard/stats')
  })

  it('preserves other query params for profile tabs', () => {
    const result = resolveSignedInProfilePath(
      'alice',
      new URLSearchParams('tab=nfts&page=2')
    )
    expect(result).toContain('/alice')
    expect(result).toContain('tab=nfts')
    expect(result).toContain('page=2')
  })

  it('ignores invalid tab values', () => {
    expect(
      resolveSignedInProfilePath('alice', new URLSearchParams('tab=invalid'))
    ).toBe('/alice')
  })
})

describe('buildLoginRedirectPath', () => {
  it('encodes intended path in next param', () => {
    expect(buildLoginRedirectPath('/dashboard/wallet')).toBe(
      '/login?next=%2Fdashboard%2Fwallet'
    )
  })
})

describe('parseSafeNextParam', () => {
  it('accepts same-site relative paths', () => {
    expect(parseSafeNextParam('/profile')).toBe('/profile')
    expect(parseSafeNextParam('/dashboard/wallet')).toBe('/dashboard/wallet')
  })

  it('rejects open redirects and external URLs', () => {
    expect(parseSafeNextParam(null)).toBeNull()
    expect(parseSafeNextParam('')).toBeNull()
    expect(parseSafeNextParam('//evil.com')).toBeNull()
    expect(parseSafeNextParam('https://evil.com')).toBeNull()
    expect(parseSafeNextParam('profile')).toBeNull()
  })
})

describe('buildPathWithSearch', () => {
  it('joins pathname and query string', () => {
    expect(
      buildPathWithSearch('/profile', new URLSearchParams('tab=wallet'))
    ).toBe('/profile?tab=wallet')
    expect(buildPathWithSearch('/profile', new URLSearchParams())).toBe(
      '/profile'
    )
  })
})

describe('appendNextToAuthPath', () => {
  it('returns bare auth path when next is unsafe', () => {
    expect(appendNextToAuthPath('/login', '//evil.com')).toBe('/login')
  })

  it('appends safe next param', () => {
    expect(appendNextToAuthPath('/login', '/dashboard/wallet')).toBe(
      '/login?next=%2Fdashboard%2Fwallet'
    )
    expect(appendNextToAuthPath('/register', '/profile')).toBe(
      '/register?next=%2Fprofile'
    )
  })
})
