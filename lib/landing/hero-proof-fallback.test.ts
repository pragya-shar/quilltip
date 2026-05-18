import { describe, expect, it } from 'vitest'
import { resolveHeroProofMode } from './hero-proof-fallback'

describe('resolveHeroProofMode', () => {
  it('returns loading while articles are unresolved', () => {
    expect(resolveHeroProofMode(undefined, true)).toBe('loading')
    expect(resolveHeroProofMode(undefined, false)).toBe('loading')
  })

  it('returns live when published articles exist', () => {
    expect(resolveHeroProofMode(2, false)).toBe('live')
    expect(resolveHeroProofMode(1, false)).toBe('live')
  })

  it('returns screenshot when the feed is empty', () => {
    expect(resolveHeroProofMode(0, false)).toBe('screenshot')
  })
})
