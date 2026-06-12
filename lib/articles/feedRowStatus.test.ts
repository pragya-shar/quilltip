import { describe, expect, it } from 'vitest'
import {
  formatReadTime,
  getFeedRowContextLabel,
  getFeedRowStatusLabel,
} from './feedRowStatus'

describe('getFeedRowContextLabel', () => {
  it('returns Reader-supported on featured view with tips', () => {
    expect(getFeedRowContextLabel('featured', { tipCount: 3 })).toBe(
      'Reader-supported'
    )
  })

  it('returns null on featured when there are no tips', () => {
    expect(getFeedRowContextLabel('featured', { tipCount: 0 })).toBeNull()
  })

  it('returns Trending when engagement exists on trending view', () => {
    expect(getFeedRowContextLabel('trending', { tipCount: 1 })).toBe('Trending')
    expect(getFeedRowContextLabel('trending', { highlightCount: 2 })).toBe(
      'Trending'
    )
  })

  it('returns null on latest view', () => {
    expect(getFeedRowContextLabel('latest', { tipCount: 5 })).toBeNull()
  })
})

describe('getFeedRowStatusLabel', () => {
  it('delegates to getFeedRowContextLabel', () => {
    expect(getFeedRowStatusLabel('featured', { tipCount: 1 })).toBe(
      'Reader-supported'
    )
  })
})

describe('formatReadTime', () => {
  it('formats minutes', () => {
    expect(formatReadTime(7)).toBe('7 min read')
  })

  it('returns null for missing or zero values', () => {
    expect(formatReadTime(0)).toBeNull()
    expect(formatReadTime(undefined)).toBeNull()
  })
})
