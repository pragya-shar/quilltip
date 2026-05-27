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

  it('includes tab query for non-articles tabs', () => {
    expect(buildGenericProfilePath('wallet')).toBe('/profile?tab=wallet')
    expect(buildGenericProfilePath('earnings')).toBe('/profile?tab=earnings')
  })
})

describe('resolveSignedInProfilePath', () => {
  it('returns username path without tab by default', () => {
    expect(resolveSignedInProfilePath('alice', new URLSearchParams())).toBe(
      '/alice'
    )
  })

  it('maps wallet tab to profile URL', () => {
    expect(
      resolveSignedInProfilePath('alice', new URLSearchParams('tab=wallet'))
    ).toBe('/alice?tab=wallet')
  })

  it('preserves other query params', () => {
    const result = resolveSignedInProfilePath(
      'alice',
      new URLSearchParams('tab=wallet&page=2')
    )
    expect(result).toContain('/alice')
    expect(result).toContain('tab=wallet')
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
    expect(buildLoginRedirectPath('/profile?tab=wallet')).toBe(
      '/login?next=%2Fprofile%3Ftab%3Dwallet'
    )
  })
})

describe('parseSafeNextParam', () => {
  it('accepts same-site relative paths', () => {
    expect(parseSafeNextParam('/profile')).toBe('/profile')
    expect(parseSafeNextParam('/profile?tab=wallet')).toBe(
      '/profile?tab=wallet'
    )
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
    expect(appendNextToAuthPath('/login', '/profile?tab=wallet')).toBe(
      '/login?next=%2Fprofile%3Ftab%3Dwallet'
    )
    expect(appendNextToAuthPath('/register', '/profile')).toBe(
      '/register?next=%2Fprofile'
    )
  })
})
