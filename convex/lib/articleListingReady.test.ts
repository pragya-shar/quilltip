import { describe, expect, it } from 'vitest'
import {
  getListingReadyPublishError,
  isArticleListingReady,
  isPlaceholderListingTitle,
  MIN_LISTING_EXCERPT_CHARS,
} from './articleListingReady'

describe('isPlaceholderListingTitle', () => {
  it('treats Untitled as placeholder', () => {
    expect(isPlaceholderListingTitle('Untitled')).toBe(true)
    expect(isPlaceholderListingTitle('  untitled  ')).toBe(true)
  })

  it('does not treat real titles as placeholder', () => {
    expect(isPlaceholderListingTitle('My Article')).toBe(false)
    expect(isPlaceholderListingTitle('Untitled Adventures')).toBe(false)
  })
})

describe('getListingReadyPublishError', () => {
  it('returns null when title and excerpt meet requirements', () => {
    expect(
      getListingReadyPublishError({
        title: 'My Post',
        excerpt: 'a'.repeat(MIN_LISTING_EXCERPT_CHARS),
      })
    ).toBeNull()
  })

  it('returns messages for invalid title or excerpt', () => {
    expect(
      getListingReadyPublishError({ title: 'Untitled', excerpt: 'abcdefghij' })
    ).toMatch(/real title/)
    expect(
      getListingReadyPublishError({ title: 'OK', excerpt: 'short' })
    ).toMatch(/excerpt/)
  })
})

describe('isArticleListingReady', () => {
  const ready = {
    title: 'Real Title',
    excerpt: 'a'.repeat(MIN_LISTING_EXCERPT_CHARS),
    authorUsername: 'writer',
  }

  it('accepts a listing-ready article', () => {
    expect(isArticleListingReady(ready)).toBe(true)
  })

  it('rejects Untitled', () => {
    expect(
      isArticleListingReady({ ...ready, title: 'Untitled' })
    ).toBe(false)
  })

  it('rejects whitespace-only title', () => {
    expect(isArticleListingReady({ ...ready, title: '   ' })).toBe(false)
  })

  it('rejects short or missing excerpt', () => {
    expect(isArticleListingReady({ ...ready, excerpt: '' })).toBe(false)
    expect(
      isArticleListingReady({
        ...ready,
        excerpt: 'a'.repeat(MIN_LISTING_EXCERPT_CHARS - 1),
      })
    ).toBe(false)
  })

  it('rejects missing author username', () => {
    expect(
      isArticleListingReady({ ...ready, authorUsername: undefined })
    ).toBe(false)
    expect(
      isArticleListingReady({ ...ready, authorUsername: '  ' })
    ).toBe(false)
  })
})
