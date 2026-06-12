import { describe, expect, it } from 'vitest'
import { engagementScore, sortArticlesForBrowse } from './articleBrowseSort'

type Row = {
  id: string
  publishedAt?: number
  tipCount?: number
  highlightCount?: number
}

function row(
  id: string,
  publishedAt: number,
  tipCount = 0,
  highlightCount = 0
): Row {
  return { id, publishedAt, tipCount, highlightCount }
}

describe('engagementScore', () => {
  it('weights tips more than highlights', () => {
    expect(engagementScore({ tipCount: 1 })).toBe(3)
    expect(engagementScore({ highlightCount: 1 })).toBe(1)
  })
})

describe('sortArticlesForBrowse', () => {
  const articles = [
    row('old', 100, 0, 0),
    row('new', 200, 0, 0),
    row('tipped', 150, 2, 0),
  ]

  it('sorts latest by newest', () => {
    const { articles: sorted } = sortArticlesForBrowse(
      articles,
      'latest',
      'newest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['new', 'tipped', 'old'])
  })

  it('sorts latest by oldest', () => {
    const { articles: sorted } = sortArticlesForBrowse(
      articles,
      'latest',
      'oldest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['old', 'tipped', 'new'])
  })

  it('sorts latest by most tipped', () => {
    const { articles: sorted } = sortArticlesForBrowse(
      articles,
      'latest',
      'most_tipped'
    )
    expect(sorted.map((a) => a.id)).toEqual(['tipped', 'new', 'old'])
  })

  it('featured returns tipped articles first', () => {
    const { articles: sorted, meta } = sortArticlesForBrowse(
      articles,
      'featured',
      'newest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['tipped'])
    expect(meta.featuredFallback).toBeUndefined()
  })

  it('featured falls back to latest when no tips', () => {
    const noTips = [row('old', 100), row('new', 200)]
    const { articles: sorted, meta } = sortArticlesForBrowse(
      noTips,
      'featured',
      'newest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['new', 'old'])
    expect(meta.featuredFallback).toBe(true)
  })

  it('trending sorts by engagement score', () => {
    const mixed = [
      row('low', 300, 0, 1),
      row('high', 100, 1, 0),
      row('mid', 200, 0, 2),
    ]
    const { articles: sorted } = sortArticlesForBrowse(
      mixed,
      'trending',
      'newest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['high', 'mid', 'low'])
  })

  it('trending falls back when all scores are zero', () => {
    const noEngagement = [row('old', 100), row('new', 200)]
    const { articles: sorted, meta } = sortArticlesForBrowse(
      noEngagement,
      'trending',
      'newest'
    )
    expect(sorted.map((a) => a.id)).toEqual(['new', 'old'])
    expect(meta.trendingFallback).toBe(true)
  })
})
