import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PENDING_TIP_INTENT_STORAGE_KEY,
  clearPendingTipIntent,
  matchesArticlePendingIntent,
  matchesHighlightPendingIntent,
  readPendingTipIntent,
  writePendingTipIntent,
} from './pendingTipIntent'
import type { Id } from '@/convex/_generated/dataModel'

describe('pendingTipIntent storage', () => {
  const store: Record<string, string> = {}
  const local: Record<string, string> = {}

  beforeEach(() => {
    clearPendingTipIntent()
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
          for (const key of Object.keys(store)) delete store[key]
        },
      },
      localStorage: {
        getItem: (k: string) => (k in local ? local[k] : null),
        setItem: (k: string, v: string) => {
          local[k] = v
        },
        removeItem: (k: string) => {
          delete local[k]
        },
        clear: () => {
          for (const key of Object.keys(local)) delete local[key]
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(store)) delete store[key]
    for (const key of Object.keys(local)) delete local[key]
  })

  it('writes and reads article intent', () => {
    writePendingTipIntent({
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 100,
      message: 'Great read',
    })
    expect(readPendingTipIntent()).toEqual({
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 100,
      message: 'Great read',
    })
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()
    expect(local[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()
  })

  it('writes and reads highlight intent', () => {
    writePendingTipIntent({
      kind: 'highlight',
      articleId: 'articles:abc',
      articleSlug: 'my-post',
      highlightText: 'insightful phrase',
      startOffset: 10,
      endOffset: 28,
      amountCents: 50,
    })
    expect(readPendingTipIntent()).toEqual({
      kind: 'highlight',
      articleId: 'articles:abc',
      articleSlug: 'my-post',
      highlightText: 'insightful phrase',
      startOffset: 10,
      endOffset: 28,
      amountCents: 50,
    })
  })

  it('returns null for missing or invalid stored data', () => {
    expect(readPendingTipIntent()).toBeNull()
    store[PENDING_TIP_INTENT_STORAGE_KEY] = 'not-json'
    expect(readPendingTipIntent()).toBeNull()
    store[PENDING_TIP_INTENT_STORAGE_KEY] = JSON.stringify({ kind: 'unknown' })
    expect(readPendingTipIntent()).toBeNull()
  })

  it('clears stored intent', () => {
    writePendingTipIntent({
      kind: 'article',
      articleId: 'articles:abc',
    })
    clearPendingTipIntent()
    expect(readPendingTipIntent()).toBeNull()
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeUndefined()
    expect(local[PENDING_TIP_INTENT_STORAGE_KEY]).toBeUndefined()
  })
})

describe('matchesArticlePendingIntent / matchesHighlightPendingIntent', () => {
  const articleId = 'articles:abc' as Id<'articles'>

  it('matches article intent by id', () => {
    const intent = {
      kind: 'article' as const,
      articleId: 'articles:abc',
    }
    expect(matchesArticlePendingIntent(intent, articleId)).toBe(true)
    expect(matchesHighlightPendingIntent(intent, articleId)).toBe(false)
  })

  it('matches highlight intent by id', () => {
    const intent = {
      kind: 'highlight' as const,
      articleId: 'articles:abc',
      articleSlug: 'slug',
      highlightText: 'text',
      startOffset: 0,
      endOffset: 4,
    }
    expect(matchesHighlightPendingIntent(intent, articleId)).toBe(true)
    expect(matchesArticlePendingIntent(intent, articleId)).toBe(false)
  })

  it('returns false for null or mismatched id', () => {
    expect(matchesArticlePendingIntent(null, articleId)).toBe(false)
    expect(
      matchesArticlePendingIntent(
        { kind: 'article', articleId: 'articles:other' },
        articleId
      )
    ).toBe(false)
  })
})
