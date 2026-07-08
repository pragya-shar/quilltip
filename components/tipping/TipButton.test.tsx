/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TipButton } from '@/components/tipping/TipButton'

const mockRedirectToLoginForTip = vi.hoisted(() => vi.fn())
const mockIsAuthenticated = vi.hoisted(() => vi.fn(() => false))
const mockIsConnected = vi.hoisted(() => vi.fn(() => false))
const mockUseArticleTipResume = vi.hoisted(() => vi.fn())
const mockCanTipQuery = vi.hoisted(() => vi.fn())
const mockSendTipMutation = vi.hoisted(() => vi.fn())
const mockSignTransaction = vi.hoisted(() => vi.fn())
const mockConnect = vi.hoisted(() => vi.fn())
const mockBuildTipTransaction = vi.hoisted(() => vi.fn())
const mockSubmitTipTransaction = vi.hoisted(() => vi.fn())
const mockTipDialogFooterNote = vi.hoisted(() =>
  vi.fn(() => 'Review footer note from copy helper')
)

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockCanTipQuery }),
  useMutation: () => mockSendTipMutation,
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated() }),
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isConnected: mockIsConnected(),
    isLoading: false,
    publicKey: mockIsConnected() ? 'GABCDEF123456789' : null,
    signTransaction: mockSignTransaction,
    connect: mockConnect,
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

vi.mock('@/lib/stellar/client', () => ({
  stellarClient: {
    buildTipTransaction: (...args: unknown[]) =>
      mockBuildTipTransaction(...args),
    submitTipTransaction: (...args: unknown[]) =>
      mockSubmitTipTransaction(...args),
  },
}))

vi.mock('@/lib/copy/network-status', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/copy/network-status')
  >('@/lib/copy/network-status')
  return {
    ...actual,
    tipDialogFooterNote: () => mockTipDialogFooterNote(),
  }
})

vi.mock('@/lib/tip/redirectToLoginForTip', () => ({
  redirectToLoginForTip: (...args: unknown[]) =>
    mockRedirectToLoginForTip(...args),
}))

vi.mock('@/lib/tip/pendingTipIntent', () => ({
  clearPendingTipIntent: vi.fn(),
}))

vi.mock('@/hooks/useArticleTipResume', () => ({
  useArticleTipResume: (opts: { onResume: (intent: unknown) => void }) => {
    mockUseArticleTipResume(opts)
  },
}))

vi.mock('@/lib/stellar/stellar-flow-emitter', () => ({
  stellarFlowEmitter: { subscribe: () => () => {}, emit: vi.fn() },
  tipFlowProgressLabel: () => 'Processing',
}))

vi.mock('@/components/stellar/InstallWalletDialog', () => ({
  InstallWalletDialog: () => null,
}))

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

async function openArticleTipModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Tip Author/i }))
}

async function selectPresetAndContinue(
  user: ReturnType<typeof userEvent.setup>,
  label = '$1'
) {
  await openArticleTipModal(user)
  await user.click(screen.getByRole('button', { name: label }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('TipButton two-stage flow', () => {
  beforeEach(() => {
    mockRedirectToLoginForTip.mockClear()
    mockUseArticleTipResume.mockClear()
    mockIsAuthenticated.mockReturnValue(false)
    mockIsConnected.mockReturnValue(false)
    mockCanTipQuery.mockReset()
    mockCanTipQuery.mockResolvedValue({ allowed: true })
    mockSendTipMutation.mockReset()
    mockSendTipMutation.mockResolvedValue('tip-id')
    mockSignTransaction.mockReset()
    mockSignTransaction.mockResolvedValue('signed-xdr')
    mockConnect.mockReset()
    mockBuildTipTransaction.mockReset()
    mockBuildTipTransaction.mockResolvedValue({
      xdr: 'unsigned-xdr',
      stroops: 10_000_000,
      platformFee: 0.01,
      authorReceived: 0.99,
    })
    mockSubmitTipTransaction.mockReset()
    mockSubmitTipTransaction.mockResolvedValue({
      transactionHash: 'tx-article-123456789',
      tipId: 'contract-tip-article',
    })
    mockTipDialogFooterNote.mockClear()
  })

  it('shows Continue on stage 1 without wallet or sign-in CTAs', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await openArticleTipModal(user)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign in to tip' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect Wallet' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send Tip' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Connect your Stellar wallet/i)
    ).not.toBeInTheDocument()
  })

  it('disables Continue until an amount is selected', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await openArticleTipModal(user)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('shows Sign in to tip on stage 2 when signed out', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await selectPresetAndContinue(user)

    expect(
      screen.getByRole('button', { name: 'Sign in to tip' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$1' })).not.toBeInTheDocument()
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

    await selectPresetAndContinue(user)
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

  it('shows Connect Wallet on stage 2 when signed in without wallet', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await selectPresetAndContinue(user)

    expect(
      screen.getByRole('button', { name: 'Connect Wallet' })
    ).toBeInTheDocument()
  })

  it('shows Send Tip on stage 2 when signed in with wallet', async () => {
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

    await selectPresetAndContinue(user)

    expect(screen.getByRole('button', { name: 'Send Tip' })).toBeInTheDocument()
  })

  it('renders the shared checkout footer note on stage 2', async () => {
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

    await selectPresetAndContinue(user)

    expect(mockTipDialogFooterNote).toHaveBeenCalled()
    expect(
      screen.getByText(/Review footer note from copy helper/)
    ).toBeInTheDocument()
  })

  it('returns to stage 1 with amount preserved when Back is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$1' })).toBeInTheDocument()
  })

  it('shows inline alert for invalid tip amount on stage 1 Continue', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await openArticleTipModal(user)
    const customInput = screen.getByPlaceholderText('0.00')
    await user.type(customInput, '0')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/valid amount/i)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('opens at checkout on resume after login', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)

    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    const onResume = mockUseArticleTipResume.mock.calls[0]![0].onResume

    await act(async () => {
      onResume({
        kind: 'article',
        articleId: 'articles:abc',
        amountCents: 500,
        message: 'Thanks!',
      })
    })

    expect(screen.getByRole('button', { name: 'Send Tip' })).toBeInTheDocument()
    expect(screen.getByText(/Tip amount: \$5\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Thanks!/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue' })
    ).not.toBeInTheDocument()
  })

  it('retries Convex sync for a submitted tip without resubmitting Stellar tx', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSendTipMutation
      .mockRejectedValueOnce(new Error('Convex unavailable'))
      .mockResolvedValueOnce('tip-id')
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(
      await screen.findByText('Tip sent, app sync failed')
    ).toBeInTheDocument()
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSendTipMutation).toHaveBeenCalledTimes(2)
    })
    expect(mockSendTipMutation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stellarTxId: 'tx-article-123456789',
      })
    )
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
  })
})
