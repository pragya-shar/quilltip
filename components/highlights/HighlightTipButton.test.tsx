/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const mockIsConnected = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockAuth.isAuthenticated }),
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isConnected: mockIsConnected(),
    isLoading: false,
    publicKey: mockIsConnected() ? 'GABCDEF123456789' : null,
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

async function openHighlightTipAndContinue(
  user: ReturnType<typeof userEvent.setup>,
  presetLabel = '$1'
) {
  await user.click(screen.getByRole('button', { name: 'Tip Highlight' }))
  await user.click(screen.getByRole('button', { name: presetLabel }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('HighlightTipButton two-stage flow', () => {
  beforeEach(() => {
    mockAuth.isAuthenticated = false
    mockIsConnected.mockReturnValue(false)
    writePendingHighlightSelection.mockClear()
    signInToTip.mockClear()
    clearPendingTipIntent.mockClear()
    readPendingTipIntent.mockReturnValue(null)
  })

  it('shows Continue on stage 1 without sign-in CTA', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <HighlightTipButton
        articleId={'articles:123' as never}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Tip Highlight' }))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in to tip' })
    ).not.toBeInTheDocument()
  })

  it('persists pending highlight selection before Sign in to tip on stage 2', async () => {
    mockAuth.isAuthenticated = false
    const user = userEvent.setup({ delay: null })
    render(
      <HighlightTipButton
        articleId={'articles:123' as never}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
      />
    )

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Sign in to tip' }))

    expect(writePendingHighlightSelection).toHaveBeenCalledWith({
      articleId: 'articles:123',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    })
    expect(signInToTip).toHaveBeenCalled()
  })

  it('opens at checkout on resume with Sign in to tip visible', () => {
    mockAuth.isAuthenticated = false
    render(
      <HighlightTipButton
        articleId={'articles:123' as never}
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

    expect(
      screen.getByRole('button', { name: 'Sign in to tip' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Tip amount: \$5\.00/)).toBeInTheDocument()
  })

  it('restores amount from pending tip intent and opens checkout', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
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
        articleId={'articles:123' as never}
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

    expect(await screen.findByTestId('highlight-tip-dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send Tip' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument()
    expect(clearPendingTipIntent).toHaveBeenCalled()
    raf.mockRestore()
  })

  it('shows Connect Wallet on stage 2 when signed in without wallet', async () => {
    mockAuth.isAuthenticated = true
    const user = userEvent.setup({ delay: null })
    render(
      <HighlightTipButton
        articleId={'articles:123' as never}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GABC"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
      />
    )

    await openHighlightTipAndContinue(user)

    expect(
      screen.getByRole('button', { name: 'Connect Wallet' })
    ).toBeInTheDocument()
  })
})
