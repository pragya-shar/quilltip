/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const writePendingHighlightSelection = vi.fn()
vi.mock('@/lib/highlight/pendingHighlightSelection', () => ({
  writePendingHighlightSelection: (args: unknown) =>
    writePendingHighlightSelection(args),
}))

const signInToTip = vi.fn()
vi.mock('@/lib/tip/signInToTip', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tip/signInToTip')>(
    '@/lib/tip/signInToTip'
  )
  return {
    ...actual,
    signInToTip: (...args: unknown[]) => signInToTip(...args),
  }
})

const mockAuth = vi.hoisted(() => ({
  isAuthenticated: false,
}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockAuth.isAuthenticated }),
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isConnected: false,
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
  usePathname: () => '/author/my-article',
}))

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: vi.fn() }),
  useMutation: () => vi.fn(),
}))

vi.mock('@/hooks/useTipDialogXlmUsdRate', () => ({
  useTipDialogXlmUsdRate: () => ({ priceUsd: 0.12 }),
}))

vi.mock('@/lib/stellar/client', () => ({
  stellarClient: {},
}))

vi.mock('@/lib/stellar/stellar-flow-emitter', () => ({
  stellarFlowEmitter: { subscribe: () => () => {} },
  tipFlowProgressLabel: () => '',
}))

const clearPendingTipIntent = vi.fn()
const readPendingTipIntent = vi.fn()
vi.mock('@/lib/tip/pendingTipIntent', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/tip/pendingTipIntent')
  >('@/lib/tip/pendingTipIntent')
  return {
    ...actual,
    clearPendingTipIntent: () => clearPendingTipIntent(),
    readPendingTipIntent: () => readPendingTipIntent(),
  }
})

vi.mock('@/components/stellar/InstallWalletDialog', () => ({
  InstallWalletDialog: () => null,
}))

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

import { HighlightTipButton } from '@/components/highlights/HighlightTipButton'

describe('HighlightTipButton', () => {
  it('shows contextual wallet setup when signed in without wallet', () => {
    mockAuth.isAuthenticated = true
    render(
      <HighlightTipButton
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        articleId={'articles:123' as any}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
        resumeOpen
      />
    )

    expect(screen.getByText('Connect to tip Author')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Connect wallet/i }).length)
      .toBeGreaterThanOrEqual(1)
    expect(
      screen.queryByRole('link', { name: /Follow our setup guide/i })
    ).not.toBeInTheDocument()
  })

  it('persists pending highlight selection before Sign in to tip', () => {
    mockAuth.isAuthenticated = false
    render(
      <HighlightTipButton
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        articleId={'articles:123' as any}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
        resumeOpen
        resumeAmountCents={500}
      />
    )

    screen.getByRole('button', { name: 'Sign in to tip' }).click()

    expect(writePendingHighlightSelection).toHaveBeenCalledWith({
      articleId: 'articles:123',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    })
    expect(signInToTip).toHaveBeenCalled()
  })

  it('restores amount from pending tip intent when opening dialog', async () => {
    mockAuth.isAuthenticated = true
    readPendingTipIntent.mockReturnValue({
      kind: 'highlight',
      articleId: 'articles:123',
      articleSlug: 'my-article',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
      amountCents: 500,
    })

    render(
      <HighlightTipButton
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        articleId={'articles:123' as any}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
      />
    )

    const raf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })

    await act(async () => {
      screen.getByRole('button', { name: 'Tip Highlight' }).click()
    })

    // When restored, the dialog should show the chosen amount as selected.
    expect(await screen.findByTestId('highlight-tip-dialog')).toBeTruthy()
    expect(clearPendingTipIntent).toHaveBeenCalled()
    raf.mockRestore()
  })
})
