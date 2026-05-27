import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY,
  clearPendingHighlightSelection,
  matchesPendingHighlightSelection,
  readPendingHighlightSelection,
  writePendingHighlightSelection,
} from './pendingHighlightSelection'
import type { Id } from '@/convex/_generated/dataModel'

describe('pendingHighlightSelection storage', () => {
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
          for (const key of Object.keys(store)) delete store[key]
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(store)) delete store[key]
  })

  it('writes and reads highlight selection', () => {
    writePendingHighlightSelection({
      articleId: 'articles:abc',
      highlightText: 'Selected passage',
      startOffset: 10,
      endOffset: 28,
    })
    expect(readPendingHighlightSelection()).toEqual({
      articleId: 'articles:abc',
      highlightText: 'Selected passage',
      startOffset: 10,
      endOffset: 28,
    })
    expect(store[PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY]).toBeDefined()
  })

  it('clears stored selection', () => {
    writePendingHighlightSelection({
      articleId: 'articles:abc',
      highlightText: 'text',
      startOffset: 0,
      endOffset: 4,
    })
    clearPendingHighlightSelection()
    expect(readPendingHighlightSelection()).toBeNull()
  })

  it('matches selection by article id', () => {
    writePendingHighlightSelection({
      articleId: 'articles:abc',
      highlightText: 'text',
      startOffset: 0,
      endOffset: 4,
    })
    const pending = readPendingHighlightSelection()
    expect(
      matchesPendingHighlightSelection(
        pending,
        'articles:abc' as Id<'articles'>
      )
    ).toBe(true)
    expect(
      matchesPendingHighlightSelection(
        pending,
        'articles:other' as Id<'articles'>
      )
    ).toBe(false)
  })
})
