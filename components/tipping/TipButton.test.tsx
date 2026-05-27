/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TipButton } from '@/components/tipping/TipButton'

const mockRedirectToLoginForTip = vi.hoisted(() => vi.fn())
const mockIsAuthenticated = vi.hoisted(() => vi.fn(() => false))
const mockIsConnected = vi.hoisted(() => vi.fn(() => false))

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: vi.fn() }),
  useMutation: () => vi.fn(),
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated() }),
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isConnected: mockIsConnected(),
    publicKey: null,
    signTransaction: vi.fn(),
    connect: vi.fn(),
  }),
}))

vi.mock('@/components/providers/WalletActivationContext', () => ({
  useWalletActivation: () => ({ activateWallet: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/author/article-slug',
}))

vi.mock('@/hooks/useTipDialogXlmUsdRate', () => ({
  useTipDialogXlmUsdRate: () => ({ priceUsd: null }),
}))

vi.mock('@/lib/tip/redirectToLoginForTip', () => ({
  redirectToLoginForTip: (...args: unknown[]) => mockRedirectToLoginForTip(...args),
}))

vi.mock('@/lib/tip/pendingTipIntent', () => ({
  clearPendingTipIntent: vi.fn(),
}))

vi.mock('@/hooks/useArticleTipResume', () => ({
  useArticleTipResume: vi.fn(),
}))

vi.mock('@/lib/stellar/stellar-flow-emitter', () => ({
  stellarFlowEmitter: { subscribe: () => () => {} },
  tipFlowProgressLabel: () => 'Processing',
}))

describe('TipButton auth-first CTA', () => {
  beforeEach(() => {
    mockRedirectToLoginForTip.mockClear()
    mockIsAuthenticated.mockReturnValue(false)
    mockIsConnected.mockReturnValue(false)
  })

  it('shows Sign in to tip when signed out', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await user.click(screen.getByRole('button', { name: /Tip Author/i }))
    await user.click(screen.getByRole('button', { name: '$1' }))
    expect(
      screen.getByRole('button', { name: 'Sign in to tip' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect Wallet' })
    ).not.toBeInTheDocument()
  })

  it('redirects to login with article intent when Sign in to tip is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await user.click(screen.getByRole('button', { name: /Tip Author/i }))
    await user.click(screen.getByRole('button', { name: '$1' }))
    await user.click(screen.getByRole('button', { name: 'Sign in to tip' }))

    expect(mockRedirectToLoginForTip).toHaveBeenCalledWith(
      expect.anything(),
      '/author/article-slug',
      expect.objectContaining({
        kind: 'article',
        articleId: 'articles:abc',
        amountCents: 100,
      })
    )
  })

  it('shows Connect Wallet when signed in without wallet', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await user.click(screen.getByRole('button', { name: /Tip Author/i }))
    expect(
      screen.getByRole('button', { name: 'Connect Wallet' })
    ).toBeInTheDocument()
  })

  it('shows Send Tip when signed in with wallet', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await user.click(screen.getByRole('button', { name: /Tip Author/i }))
    expect(screen.getByRole('button', { name: 'Send Tip' })).toBeInTheDocument()
  })

})
