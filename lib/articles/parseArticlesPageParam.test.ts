import { describe, expect, it } from 'vitest'
import { parseArticlesPageParam } from '@/lib/articles/parseArticlesPageParam'

describe('parseArticlesPageParam', () => {
  it('returns positive integer pages unchanged', () => {
    expect(parseArticlesPageParam('1')).toBe(1)
    expect(parseArticlesPageParam('12')).toBe(12)
  })

  it('falls back to page 1 for malformed values', () => {
    expect(parseArticlesPageParam(null)).toBe(1)
    expect(parseArticlesPageParam('abc')).toBe(1)
    expect(parseArticlesPageParam('0')).toBe(1)
    expect(parseArticlesPageParam('-2')).toBe(1)
    expect(parseArticlesPageParam('1.5')).toBe(1)
    expect(parseArticlesPageParam('Infinity')).toBe(1)
  })
})
