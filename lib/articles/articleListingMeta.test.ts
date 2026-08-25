import { describe, expect, it } from 'vitest'
import {
  buildListingMetaParts,
  formatListingPublishedDate,
  formatListingReadTime,
  formatListingTipCount,
  getTitleMonogram,
} from './articleListingMeta'

describe('getTitleMonogram', () => {
  it('returns first two characters of title', () => {
    expect(getTitleMonogram('Hello World')).toBe('He')
  })

  it('returns fallback for empty title', () => {
    expect(getTitleMonogram('   ')).toBe('QT')
  })
})

describe('formatListingPublishedDate', () => {
  it('returns null for missing or invalid dates', () => {
    expect(formatListingPublishedDate(null)).toBeNull()
    expect(formatListingPublishedDate('not-a-date')).toBeNull()
  })

  it('returns relative date string', () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const result = formatListingPublishedDate(weekAgo)
    expect(result).toMatch(/ago/)
  })
})

describe('formatListingReadTime', () => {
  it('formats minutes', () => {
    expect(formatListingReadTime(7)).toBe('7 min read')
  })

  it('returns null for missing or zero values', () => {
    expect(formatListingReadTime(0)).toBeNull()
    expect(formatListingReadTime(undefined)).toBeNull()
  })
})

describe('formatListingTipCount', () => {
  it('formats singular and plural tips', () => {
    expect(formatListingTipCount(1)).toBe('1 tip')
    expect(formatListingTipCount(3)).toBe('3 tips')
  })

  it('returns null when no tips', () => {
    expect(formatListingTipCount(0)).toBeNull()
    expect(formatListingTipCount(undefined)).toBeNull()
  })
})

describe('buildListingMetaParts', () => {
  it('orders parts as read time, date, tips', () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const parts = buildListingMetaParts({
      readTime: 5,
      publishedAt: weekAgo,
      tipCount: 2,
    })

    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('5 min read')
    expect(parts[1]).toMatch(/ago/)
    expect(parts[2]).toBe('2 tips')
  })

  it('omits null parts', () => {
    expect(
      buildListingMetaParts({
        readTime: undefined,
        publishedAt: null,
        tipCount: 0,
      })
    ).toEqual([])
  })
})
