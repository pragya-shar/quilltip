import { describe, expect, it } from 'vitest'
import {
  getAuthIntent,
  getLoginCopy,
  getRegisterCopy,
} from '@/lib/copy/auth-intent'

describe('getAuthIntent', () => {
  it('detects write intent from editor paths', () => {
    expect(getAuthIntent('/write')).toBe('write')
    expect(getAuthIntent('/write?id=abc')).toBe('write')
  })

  it('detects read intent from article paths', () => {
    expect(getAuthIntent('/articles')).toBe('read')
    expect(getAuthIntent('/articles/some-slug')).toBe('read')
  })

  it('falls back to default for other paths', () => {
    expect(getAuthIntent('/')).toBe('default')
    expect(getAuthIntent('/profile')).toBe('default')
  })
})

describe('getRegisterCopy', () => {
  it('promises editor access for write intent', () => {
    const copy = getRegisterCopy('/write')
    expect(copy.subtitle).toMatch(/editor/i)
    expect(copy.submitLabel).toBe('Create account and start writing')
  })

  it('uses concrete default messaging', () => {
    const copy = getRegisterCopy('/')
    expect(copy.subtitle).toMatch(/write, publish/i)
    expect(copy.submitLabel).toBe('Create account')
  })
})

describe('getLoginCopy', () => {
  it('uses write-intent messaging for the editor', () => {
    const copy = getLoginCopy('/write')
    expect(copy.subtitle).toBe('Sign in to continue writing.')
    expect(copy.submitLabel).toBe('Sign in and continue writing')
  })

  it('uses read-intent messaging for articles', () => {
    const copy = getLoginCopy('/articles')
    expect(copy.submitLabel).toBe('Sign in and start reading')
  })
})
