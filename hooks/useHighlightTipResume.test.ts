/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHighlightTipResume } from './useHighlightTipResume'
import {
  PENDING_TIP_INTENT_STORAGE_KEY,
  writePendingTipIntent,
} from '@/lib/tip/pendingTipIntent'
import type { Id } from '@/convex/_generated/dataModel'

const mockAuth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: true,
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockAuth.isAuthenticated,
    isLoading: mockAuth.isLoading,
  }),
}))

describe('useHighlightTipResume', () => {
  const store: Record<string, string> = {}
  const local: Record<string, string> = {}
  const articleId = 'articles:abc' as Id<'articles'>

  beforeEach(() => {
    mockAuth.isAuthenticated = false
    mockAuth.isLoading = true
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
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
      },
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    writePendingTipIntent({
      kind: 'highlight',
      articleId: 'articles:abc',
      articleSlug: 'slug',
      highlightText: 'Selected text',
      startOffset: 1,
      endOffset: 10,
      amountCents: 500,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(store)) delete store[key]
    for (const key of Object.keys(local)) delete local[key]
  })

  it('waits for auth then calls onResume without clearing until modal opens', async () => {
    const onResume = vi.fn()

    const { rerender } = renderHook(
      ({ isOpen }) => useHighlightTipResume({ articleId, isOpen, onResume }),
      { initialProps: { isOpen: false } }
    )

    expect(onResume).not.toHaveBeenCalled()
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()

    mockAuth.isLoading = false
    mockAuth.isAuthenticated = true
    rerender({ isOpen: false })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'highlight',
        amountCents: 500,
        highlightText: 'Selected text',
      })
    )
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()

    rerender({ isOpen: true })
    await act(async () => {
      await Promise.resolve()
    })

    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeUndefined()
  })
})
