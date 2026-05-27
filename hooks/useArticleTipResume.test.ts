/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArticleTipResume } from './useArticleTipResume'
import {
  PENDING_TIP_INTENT_STORAGE_KEY,
  writePendingTipIntent,
} from '@/lib/tip/pendingTipIntent'
import type { Id } from '@/convex/_generated/dataModel'

const mockAuth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: true,
}))

const mockRouter = vi.hoisted(() => ({
  replace: vi.fn(),
}))

const mockSearchParams = vi.hoisted(() => new URLSearchParams())

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockAuth.isAuthenticated,
    isLoading: mockAuth.isLoading,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/alice/post',
  useSearchParams: () => mockSearchParams,
}))

describe('useArticleTipResume', () => {
  const store: Record<string, string> = {}
  const local: Record<string, string> = {}
  const articleId = 'articles:abc' as Id<'articles'>

  beforeEach(() => {
    mockAuth.isAuthenticated = false
    mockAuth.isLoading = true
    mockRouter.replace.mockClear()
    for (const key of mockSearchParams.keys()) {
      mockSearchParams.delete(key)
    }
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
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 100,
      customAmount: '1.00',
      message: 'Nice',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(store)) delete store[key]
    for (const key of Object.keys(local)) delete local[key]
  })

  it('waits for auth then calls onResume without clearing until modal opens', async () => {
    const onResume = vi.fn()
    mockSearchParams.set('resumeArticleTip', '1')

    const { rerender } = renderHook(
      ({ isOpen }) =>
        useArticleTipResume({ articleId, isOpen, onResume }),
      { initialProps: { isOpen: false } }
    )

    expect(onResume).not.toHaveBeenCalled()
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()

    mockAuth.isLoading = false
    mockAuth.isAuthenticated = true
    rerender({ isOpen: false })

    await act(async () => {
      await Promise.resolve()
    })

    expect(onResume).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'article',
        articleId: 'articles:abc',
        amountCents: 100,
      })
    )
    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeDefined()

    rerender({ isOpen: true })
    await act(async () => {
      await Promise.resolve()
    })

    expect(store[PENDING_TIP_INTENT_STORAGE_KEY]).toBeUndefined()
    expect(mockRouter.replace).toHaveBeenCalledWith('/alice/post', {
      scroll: false,
    })
  })
})
