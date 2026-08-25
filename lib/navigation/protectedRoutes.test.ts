import { describe, expect, it } from 'vitest'
import { isProtectedPath } from './protectedRoutes'

describe('isProtectedPath', () => {
  it('returns true for protected route prefixes', () => {
    expect(isProtectedPath('/write')).toBe(true)
    expect(isProtectedPath('/drafts')).toBe(true)
    expect(isProtectedPath('/dashboard')).toBe(true)
    expect(isProtectedPath('/dashboard/earnings')).toBe(true)
    expect(isProtectedPath('/profile')).toBe(true)
    expect(isProtectedPath('/settings/profile')).toBe(true)
  })

  it('returns false for public routes', () => {
    expect(isProtectedPath('/')).toBe(false)
    expect(isProtectedPath('/articles')).toBe(false)
    expect(isProtectedPath('/guide')).toBe(false)
    expect(isProtectedPath('/login')).toBe(false)
    expect(isProtectedPath('/writer')).toBe(false)
  })

  it('returns false for query-string inputs outside the usePathname contract', () => {
    // Next's usePathname returns pathnames without query strings.
    expect(isProtectedPath('/write?id=abc')).toBe(false)
    expect(isProtectedPath('/articles?search=foo')).toBe(false)
  })
})
