import { describe, expect, it } from 'vitest'
import {
  buildLoginHref,
  buildRegisterHref,
  getCurrentReturnPath,
  getSafeReturnPath,
} from './safeReturnPath'

describe('getSafeReturnPath', () => {
  it('returns fallback for null, undefined, and empty', () => {
    expect(getSafeReturnPath(null)).toBe('/')
    expect(getSafeReturnPath(undefined)).toBe('/')
    expect(getSafeReturnPath('')).toBe('/')
    expect(getSafeReturnPath('   ')).toBe('/')
  })

  it('accepts valid relative paths', () => {
    expect(getSafeReturnPath('/alice/my-article')).toBe('/alice/my-article')
    expect(getSafeReturnPath('/articles?page=2')).toBe('/articles?page=2')
  })

  it('rejects protocol-relative and absolute URLs', () => {
    expect(getSafeReturnPath('//evil.com')).toBe('/')
    expect(getSafeReturnPath('https://evil.com')).toBe('/')
    expect(getSafeReturnPath('http://evil.com/path')).toBe('/')
  })

  it('rejects paths without leading slash', () => {
    expect(getSafeReturnPath('alice/article')).toBe('/')
  })

  it('rejects javascript and data URLs', () => {
    expect(getSafeReturnPath('javascript:alert(1)')).toBe('/')
    expect(getSafeReturnPath('/x?next=data:text/html,bad')).toBe(
      '/x?next=data:text/html,bad'
    )
    expect(getSafeReturnPath('data:text/html,bad')).toBe('/')
  })

  it('rejects paths with backslashes', () => {
    expect(getSafeReturnPath('/path\\evil')).toBe('/')
  })

  it('uses custom fallback', () => {
    expect(getSafeReturnPath(null, '/articles')).toBe('/articles')
  })
})

describe('getCurrentReturnPath', () => {
  it('returns pathname only when search is empty', () => {
    expect(getCurrentReturnPath('/write', new URLSearchParams())).toBe('/write')
  })

  it('combines pathname and query string', () => {
    expect(
      getCurrentReturnPath(
        '/write',
        new URLSearchParams('id=abc123')
      )
    ).toBe('/write?id=abc123')
  })

  it('preserves multiple query params', () => {
    expect(
      getCurrentReturnPath(
        '/profile',
        new URLSearchParams('tab=wallet')
      )
    ).toBe('/profile?tab=wallet')
  })
})

describe('buildLoginHref / buildRegisterHref', () => {
  it('encodes safe return path in login URL', () => {
    expect(buildLoginHref('/user/slug')).toBe('/login?returnTo=%2Fuser%2Fslug')
  })

  it('falls back for unsafe paths', () => {
    expect(buildLoginHref('https://evil.com')).toBe('/login?returnTo=%2F')
  })

  it('encodes safe return path in register URL', () => {
    expect(buildRegisterHref('/user/slug')).toBe(
      '/register?returnTo=%2Fuser%2Fslug'
    )
  })
})
