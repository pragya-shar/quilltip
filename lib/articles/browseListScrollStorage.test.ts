import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTICLES_BROWSE_SCROLL_STORAGE_PREFIX,
  buildArticlesBrowseScrollStorageKey,
  readBrowseScrollY,
  writeBrowseScrollY,
} from './browseListScrollStorage'

describe('buildArticlesBrowseScrollStorageKey', () => {
  it('joins pathname without search when empty', () => {
    expect(buildArticlesBrowseScrollStorageKey('/articles', '')).toBe(
      `${ARTICLES_BROWSE_SCROLL_STORAGE_PREFIX}/articles`
    )
  })

  it('joins pathname and search string with question mark', () => {
    expect(
      buildArticlesBrowseScrollStorageKey('/articles', 'page=2&tag=x')
    ).toBe(
      `${ARTICLES_BROWSE_SCROLL_STORAGE_PREFIX}/articles?page=2&tag=x`
    )
  })
})

describe('readBrowseScrollY / writeBrowseScrollY', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k]
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('writes rounded non-negative y and reads it back', () => {
    const key = buildArticlesBrowseScrollStorageKey('/articles', 'page=1')
    writeBrowseScrollY(key, 120.7)
    expect(readBrowseScrollY(key)).toBe(121)
  })

  it('returns null for missing key', () => {
    const key = buildArticlesBrowseScrollStorageKey('/articles', '')
    expect(readBrowseScrollY(key)).toBeNull()
  })

  it('returns null for invalid stored value', () => {
    const key = buildArticlesBrowseScrollStorageKey('/articles', '')
    store[key] = 'not-a-number'
    expect(readBrowseScrollY(key)).toBeNull()
  })

  it('returns null for negative stored value', () => {
    const key = buildArticlesBrowseScrollStorageKey('/articles', '')
    store[key] = '-1'
    expect(readBrowseScrollY(key)).toBeNull()
  })

  it('does not write negative or non-finite y', () => {
    const key = buildArticlesBrowseScrollStorageKey('/articles', '')
    writeBrowseScrollY(key, -1)
    writeBrowseScrollY(key, Number.NaN)
    expect(store[key]).toBeUndefined()
  })
})
