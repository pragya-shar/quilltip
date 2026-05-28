import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { describe, expect, it, vi } from 'vitest'
import { validateTipAmountForm, signInToTip } from './signInToTip'

const mockRedirect = vi.hoisted(() => vi.fn())

vi.mock('./redirectToLoginForTip', () => ({
  redirectToLoginForTip: (...args: unknown[]) => mockRedirect(...args),
}))

describe('signInToTip', () => {
  it('rejects invalid amount', () => {
    const router = { replace: vi.fn() } as unknown as AppRouterInstance
    const result = validateTipAmountForm({
      selectedAmount: null,
      customAmount: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/valid amount/i)
    }
    signInToTip(
      router,
      '/article',
      { selectedAmount: null, customAmount: '' },
      {
        kind: 'article',
        articleId: 'articles:1',
      }
    )
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('redirects with valid amount', () => {
    const router = { replace: vi.fn() } as unknown as AppRouterInstance
    mockRedirect.mockClear()

    signInToTip(
      router,
      '/user/slug',
      { selectedAmount: 100, customAmount: '', message: 'Thanks' },
      { kind: 'article', articleId: 'articles:1' }
    )

    expect(mockRedirect).toHaveBeenCalledWith(router, '/user/slug', {
      kind: 'article',
      articleId: 'articles:1',
      amountCents: 100,
      message: 'Thanks',
    })
  })

  it('rejects message over 500 characters', () => {
    const result = validateTipAmountForm({
      selectedAmount: 100,
      customAmount: '',
      message: 'x'.repeat(501),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/500 characters/)
    }
  })
})
