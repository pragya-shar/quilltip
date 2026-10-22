import { describe, expect, it } from 'vitest'
import {
  getListingReadyPublishError,
  isArticleListingReady,
  isPlaceholderListingTitle,
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
        excerpt: 'A readable preview.',
      })
    ).toBeNull()
  })

  it('rejects placeholder titles but allows missing or short subtitles', () => {
    expect(
      getListingReadyPublishError({ title: 'Untitled', excerpt: 'abcdefghij' })
    ).toMatch(/real title/)
    expect(
      getListingReadyPublishError({ title: 'OK', excerpt: 'short' })
    ).toBeNull()
    expect(getListingReadyPublishError({ title: 'Real story' })).toBeNull()
  })
})

describe('isArticleListingReady', () => {
  const ready = {
    title: 'Real Title',
    excerpt: 'A readable preview.',
    authorUsername: 'writer',
  }

  it('accepts a listing-ready article', () => {
    expect(isArticleListingReady(ready)).toBe(true)
  })

  it('rejects Untitled', () => {
    expect(isArticleListingReady({ ...ready, title: 'Untitled' })).toBe(false)
  })

  it('rejects whitespace-only title', () => {
    expect(isArticleListingReady({ ...ready, title: '   ' })).toBe(false)
  })

  it('accepts short subtitles and derives readiness from opening text', () => {
    expect(isArticleListingReady({ ...ready, excerpt: '' })).toBe(false)
    expect(
      isArticleListingReady({
        ...ready,
        excerpt: 'short',
      })
    ).toBe(true)
    expect(
      isArticleListingReady({
        ...ready,
        excerpt: '',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Opening words.' }],
            },
          ],
        },
      })
    ).toBe(true)
  })

  it('rejects missing author username', () => {
    expect(isArticleListingReady({ ...ready, authorUsername: undefined })).toBe(
      false
    )
    expect(isArticleListingReady({ ...ready, authorUsername: '  ' })).toBe(
      false
    )
  })
})
