/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TipButton } from '@/components/tipping/TipButton'

const mockRedirectToLoginForTip = vi.hoisted(() => vi.fn())
const mockIsAuthenticated = vi.hoisted(() => vi.fn(() => false))
const mockIsAuthLoading = vi.hoisted(() => vi.fn(() => false))
const mockAuthUserId = vi.hoisted(() => vi.fn(() => 'users:one'))
const mockIsConnected = vi.hoisted(() => vi.fn(() => false))
const mockUseArticleTipResume = vi.hoisted(() => vi.fn())
const mockCanTipQuery = vi.hoisted(() => vi.fn())
const mockPrepareArticleTip = vi.hoisted(() => vi.fn())
const mockSubmitArticleTip = vi.hoisted(() => vi.fn())
const mockRetryArticleTipVerification = vi.hoisted(() => vi.fn())
const mockVerificationStatus = vi.hoisted(() => vi.fn())
const mockStatusQueryArgs = vi.hoisted(() => vi.fn())
const mockMutation = vi.hoisted(() =>
  vi.fn((args: Record<string, unknown>) => {
    if ('intentId' in args) return mockSubmitArticleTip(args)
    if ('tipId' in args) return mockRetryArticleTipVerification(args)
    return mockPrepareArticleTip(args)
  })
)
const mockSignTransaction = vi.hoisted(() => vi.fn())
const mockConnect = vi.hoisted(() => vi.fn())
const mockActivateWallet = vi.hoisted(() => vi.fn())
const mockBuildTipTransaction = vi.hoisted(() => vi.fn())
const mockDeriveTipTransactionHash = vi.hoisted(() => vi.fn())
const mockSubmitTipTransaction = vi.hoisted(() => vi.fn())
const mockTipDialogFooterNote = vi.hoisted(() =>
  vi.fn(() => 'Review footer note from copy helper')
)

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockCanTipQuery }),
  useMutation: () => mockMutation,
  useQuery: (_query: unknown, args: unknown) => {
    mockStatusQueryArgs(args)
    return args === 'skip' ? undefined : mockVerificationStatus()
  },
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated(),
    isLoading: mockIsAuthLoading(),
    user: mockIsAuthenticated()
      ? { _id: mockAuthUserId(), username: 'reader' }
      : null,
  }),
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
  useWalletActivation: () => ({ activateWallet: mockActivateWallet }),
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
    deriveTipTransactionHash: (...args: unknown[]) =>
      mockDeriveTipTransactionHash(...args),
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
    window.localStorage.clear()
    mockRedirectToLoginForTip.mockClear()
    mockUseArticleTipResume.mockClear()
    mockIsAuthenticated.mockReturnValue(false)
    mockIsAuthLoading.mockReturnValue(false)
    mockAuthUserId.mockReturnValue('users:one')
    mockIsConnected.mockReturnValue(false)
    mockCanTipQuery.mockReset()
    mockCanTipQuery.mockResolvedValue({ allowed: true })
    mockMutation.mockClear()
    mockPrepareArticleTip.mockReset()
    mockPrepareArticleTip.mockResolvedValue({
      intentId: 'intent-id',
      articleSymbol: 'server1234',
      authorAddress: 'GABC',
      amountStroops: 12_345_678,
      stellarNetwork: 'TESTNET',
      contractId: 'CSERVERCONTRACT',
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
    })
    mockSubmitArticleTip.mockReset()
    mockSubmitArticleTip.mockResolvedValue('tip-id')
    mockRetryArticleTipVerification.mockReset()
    mockRetryArticleTipVerification.mockResolvedValue(null)
    mockVerificationStatus.mockReset()
    mockStatusQueryArgs.mockClear()
    mockVerificationStatus.mockReturnValue({
      status: 'PENDING',
      failureReason: undefined,
      verifiedAt: undefined,
    })
    mockSignTransaction.mockReset()
    mockSignTransaction.mockResolvedValue('signed-xdr')
    mockConnect.mockReset()
    mockActivateWallet.mockReset()
    mockBuildTipTransaction.mockReset()
    mockBuildTipTransaction.mockResolvedValue({
      xdr: 'unsigned-xdr',
      stroops: 10_000_000,
      platformFee: 0.01,
      authorReceived: 0.99,
    })
    mockDeriveTipTransactionHash.mockReset()
    mockDeriveTipTransactionHash.mockResolvedValue('a'.repeat(64))
    mockSubmitTipTransaction.mockReset()
    mockSubmitTipTransaction.mockResolvedValue({
      transactionHash: 'a'.repeat(64),
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

  it('registers before first broadcast and recovers with the exact signed XDR', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSubmitArticleTip
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
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSubmitArticleTip).toHaveBeenCalledTimes(2)
    })
    expect(mockSubmitArticleTip).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stellarTxId: 'a'.repeat(64),
      })
    )
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
  })

  it('restores a paid receipt after remount and never opens the wallet again', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSubmitArticleTip
      .mockRejectedValueOnce(new Error('Convex unavailable'))
      .mockResolvedValueOnce('tip-id')
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:abc' as never,
      authorName: 'Author',
      authorStellarAddress: 'GABC',
    }
    const firstRender = render(<TipButton {...props} />)

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()

    firstRender.unmount()
    render(<TipButton {...props} />)

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSubmitArticleTip).toHaveBeenCalledTimes(2)
    })
    expect(mockSubmitArticleTip).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        intentId: 'intent-id',
        stellarTxId: 'a'.repeat(64),
      })
    )
    expect(mockPrepareArticleTip).toHaveBeenCalledTimes(1)
    expect(mockBuildTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
  })

  it('restores a legacy broadcast receipt and only registers and checks its saved hash', async () => {
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([
        {
          articleId: 'articles:abc',
          tipperId: 'users:one',
          amountCents: 100,
          message: 'Legacy tip',
          stellarNetwork: 'TESTNET',
          stellarSourceAccount: 'GABCDEF123456789',
          intentId: 'intent-legacy',
          stellarTxId: 'b'.repeat(64),
        },
      ])
    )
    mockIsAuthenticated.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    expect(
      await screen.findByText('Earlier tip saved for recovery')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check transaction' }))

    await waitFor(() => {
      expect(mockSubmitArticleTip).toHaveBeenCalledWith({
        intentId: 'intent-legacy',
        stellarTxId: 'b'.repeat(64),
        stellarLedger: undefined,
        stellarFeeCharged: undefined,
        contractTipId: undefined,
      })
      expect(mockRetryArticleTipVerification).toHaveBeenCalledWith({
        tipId: 'tip-id',
      })
    })
    expect(mockPrepareArticleTip).not.toHaveBeenCalled()
    expect(mockBuildTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(mockActivateWallet).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('never creates a replacement payment for a legacy transaction absent from Stellar', async () => {
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([
        {
          articleId: 'articles:abc',
          tipperId: 'users:one',
          amountCents: 100,
          stellarNetwork: 'TESTNET',
          stellarSourceAccount: 'GABCDEF123456789',
          intentId: 'intent-legacy',
          stellarTxId: 'c'.repeat(64),
          submittedTipId: 'tip-id',
        },
      ])
    )
    mockIsAuthenticated.mockReturnValue(true)
    mockVerificationStatus.mockReturnValue({
      status: 'FAILED',
      failureReason: 'transaction_not_found_after_indexing_grace',
      verifiedAt: undefined,
    })
    mockRetryArticleTipVerification.mockRejectedValueOnce(
      new Error('Only pending article tips can be retried')
    )
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    expect(
      await screen.findByText('Earlier tip could not be verified')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start over' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check transaction' }))

    await waitFor(() => {
      expect(mockRetryArticleTipVerification).toHaveBeenCalledWith({
        tipId: 'tip-id',
      })
    })
    expect(mockPrepareArticleTip).not.toHaveBeenCalled()
    expect(mockBuildTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(mockActivateWallet).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
    expect(
      JSON.parse(
        window.localStorage.getItem('quilltip:pendingArticleTipReceipts') ??
          '[]'
      )
    ).toEqual([
      expect.objectContaining({
        stellarTxId: 'c'.repeat(64),
        submittedTipId: 'tip-id',
      }),
    ])
  })

  it('waits for auth and restores only the matching tipper receipt', async () => {
    const { writePendingArticleTipReceipt } =
      await import('@/lib/tip/pendingArticleTipReceipt')
    writePendingArticleTipReceipt({
      articleId: 'articles:abc',
      tipperId: 'users:one' as never,
      amountCents: 100,
      message: 'Original message',
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GABCDEF123456789',
      intentId: 'intent-id' as never,
      signedXdr: 'signed-xdr',
      stellarTxId: 'tx-auth-scoped',
      submittedTipId: 'tip-id' as never,
    })
    mockIsAuthLoading.mockReturnValue(true)
    const props = {
      articleId: 'articles:abc' as never,
      authorName: 'Author',
      authorStellarAddress: 'GABC',
    }
    const view = render(<TipButton {...props} />)

    expect(mockVerificationStatus).not.toHaveBeenCalled()
    expect(screen.queryByText(/verification delayed/i)).not.toBeInTheDocument()

    mockIsAuthLoading.mockReturnValue(false)
    mockIsAuthenticated.mockReturnValue(true)
    view.rerender(<TipButton {...props} />)

    expect(await screen.findByText(/verification delayed/i)).toBeInTheDocument()
    expect(mockVerificationStatus).toHaveBeenCalledTimes(1)

    view.unmount()
    mockVerificationStatus.mockClear()
    mockAuthUserId.mockReturnValue('users:two')
    render(<TipButton {...props} />)

    expect(mockVerificationStatus).not.toHaveBeenCalled()
    expect(screen.queryByText(/verification delayed/i)).not.toBeInTheDocument()
  })

  it('reopens an unresolved paid receipt at checkout with its original values', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSubmitArticleTip.mockRejectedValueOnce(new Error('Convex unavailable'))
    const user = userEvent.setup({ delay: null })
    render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author"
        authorStellarAddress="GABC"
      />
    )

    await openArticleTipModal(user)
    await user.click(screen.getByRole('button', { name: '$1' }))
    await user.type(screen.getByLabelText(/Message to author/i), 'Original')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(
        screen.queryByText('Tip transaction saved for recovery')
      ).not.toBeInTheDocument()
    })
    await openArticleTipModal(user)

    expect(screen.getByText(/Tip amount: \$1\.00/)).toBeInTheDocument()
    expect(
      screen.getByText(
        (_text, element) => element?.textContent === 'Message: “Original”'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('does not carry a recovered receipt to a different article', async () => {
    const { writePendingArticleTipReceipt } =
      await import('@/lib/tip/pendingArticleTipReceipt')
    writePendingArticleTipReceipt({
      articleId: 'articles:abc',
      tipperId: 'users:one' as never,
      amountCents: 100,
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GABCDEF123456789',
      intentId: 'intent-id' as never,
      signedXdr: 'signed-xdr',
      stellarTxId: 'tx-article-a',
    })
    mockIsAuthenticated.mockReturnValue(true)
    const view = render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author A"
        authorStellarAddress="GABC"
      />
    )
    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()

    view.rerender(
      <TipButton
        articleId={'articles:def' as never}
        authorName="Author B"
        authorStellarAddress="GDEF"
      />
    )

    await waitFor(() => {
      expect(
        screen.queryByText('Tip transaction saved for recovery')
      ).not.toBeInTheDocument()
    })
    expect(
      screen.getByRole('button', { name: /Tip Author/i })
    ).toBeInTheDocument()
  })

  it('clears an in-session receipt when the article changes without deleting its recovery record', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSubmitArticleTip.mockRejectedValueOnce(new Error('Convex unavailable'))
    const user = userEvent.setup({ delay: null })
    const view = render(
      <TipButton
        articleId={'articles:abc' as never}
        authorName="Author A"
        authorStellarAddress="GABC"
      />
    )

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()

    view.rerender(
      <TipButton
        articleId={'articles:def' as never}
        authorName="Author B"
        authorStellarAddress="GDEF"
      />
    )

    await waitFor(() => {
      expect(
        screen.queryByText('Tip transaction saved for recovery')
      ).not.toBeInTheDocument()
    })
    const { readPendingArticleTipReceipt } =
      await import('@/lib/tip/pendingArticleTipReceipt')
    expect(
      readPendingArticleTipReceipt('articles:abc', 'TESTNET', 'users:one')
    ).toMatchObject({ stellarTxId: 'a'.repeat(64), signedXdr: 'signed-xdr' })
  })

  it('stops querying an in-session receipt immediately when the account changes', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:abc' as never,
      authorName: 'Author',
      authorStellarAddress: 'GABC',
    }
    const view = render(<TipButton {...props} />)

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    await waitFor(() => {
      expect(mockSubmitArticleTip).toHaveBeenCalledTimes(1)
    })
    expect(mockStatusQueryArgs).toHaveBeenCalledWith({ tipId: 'tip-id' })

    mockAuthUserId.mockReturnValue('users:two')
    view.rerender(<TipButton {...props} />)

    await waitFor(() => {
      expect(mockStatusQueryArgs).toHaveBeenLastCalledWith('skip')
      expect(
        screen.queryByText(/verification delayed/i)
      ).not.toBeInTheDocument()
    })
  })

  it('maps Stellar networks to the correct Stellar Expert explorer path', async () => {
    const { stellarExpertNetworkPath } =
      await import('@/components/tipping/TipButton')
    expect(stellarExpertNetworkPath('TESTNET')).toBe('testnet')
    expect(stellarExpertNetworkPath('MAINNET')).toBe('public')
  })

  it('builds from the server quote and waits for verified confirmation', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:abc' as never,
      authorName: 'Author',
      authorStellarAddress: 'GABC',
    }
    const { rerender } = render(<TipButton {...props} />)

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    mockSubmitArticleTip.mockImplementationOnce(async () => {
      const stored = JSON.parse(
        window.localStorage.getItem('quilltip:pendingArticleTipReceipts') ??
          '[]'
      ) as Array<Record<string, unknown>>
      expect(stored).toEqual([
        expect.objectContaining({
          signedXdr: 'signed-xdr',
          stellarTxId: 'a'.repeat(64),
          intentId: 'intent-id',
        }),
      ])
      return 'tip-id'
    })

    await waitFor(() => {
      expect(mockBuildTipTransaction).toHaveBeenCalledWith('GABCDEF123456789', {
        tipper: 'GABCDEF123456789',
        articleSymbol: 'server1234',
        authorAddress: 'GABC',
        amountStroops: 12_345_678,
        contractId: 'CSERVERCONTRACT',
        timeBounds: {
          minTime: '123456789',
          maxTime: '2000000000',
        },
      })
    })
    expect(mockPrepareArticleTip).toHaveBeenCalledWith({
      articleId: 'articles:abc',
      amountCents: 100,
      message: undefined,
      stellarSourceAccount: 'GABCDEF123456789',
    })
    expect(mockSubmitArticleTip).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: 'intent-id',
        stellarTxId: 'a'.repeat(64),
      })
    )
    expect(mockPrepareArticleTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(mockBuildTipTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignTransaction.mock.invocationCallOrder[0]!
    )
    expect(mockSignTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeriveTipTransactionHash.mock.invocationCallOrder[0]!
    )
    expect(
      mockDeriveTipTransactionHash.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSubmitArticleTip.mock.invocationCallOrder[0]!)
    expect(mockSubmitArticleTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(mockDeriveTipTransactionHash).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitArticleTip).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Successfully tipped/)).not.toBeInTheDocument()

    mockVerificationStatus.mockReturnValue({
      status: 'CONFIRMED',
      failureReason: undefined,
      verifiedAt: Date.now(),
    })
    rerender(<TipButton {...props} />)

    expect(await screen.findByText(/Successfully tipped/)).toBeInTheDocument()
  })

  it('does not broadcast when durable Convex registration fails', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSubmitArticleTip.mockRejectedValueOnce(new Error('Convex unavailable'))
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /saved for recovery|sync failed/i
    )
    expect(mockDeriveTipTransactionHash).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitArticleTip).toHaveBeenCalledWith(
      expect.objectContaining({ stellarTxId: 'a'.repeat(64) })
    )
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(
      JSON.parse(
        window.localStorage.getItem('quilltip:pendingArticleTipReceipts') ??
          '[]'
      )
    ).toEqual([
      expect.objectContaining({
        signedXdr: 'signed-xdr',
        stellarTxId: 'a'.repeat(64),
      }),
    ])
  })

  it('does not synchronize or persist a tip when wallet signing is cancelled', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockSignTransaction.mockRejectedValueOnce(new Error('User declined'))
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Wallet prompt was dismissed/i
    )
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(mockSubmitArticleTip).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(screen.queryByText(/Successfully tipped/)).not.toBeInTheDocument()
  })

  it('does not open the wallet when the server and browser Stellar networks differ', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockPrepareArticleTip.mockResolvedValueOnce({
      intentId: 'intent-mainnet',
      articleSymbol: 'server1234',
      authorAddress: 'GABC',
      amountStroops: 12_345_678,
      stellarNetwork: 'MAINNET',
      contractId: 'CSERVERCONTRACT',
    })
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
      await screen.findByText(/Stellar network configuration does not match/i)
    ).toBeInTheDocument()
    expect(mockBuildTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
  })

  it('rebroadcasts the exact stored XDR before retrying delayed verification', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    mockVerificationStatus.mockReturnValue({
      status: 'PENDING',
      failureReason: 'verification_temporarily_unavailable',
      verifiedAt: undefined,
    })
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
      await screen.findByText('Tip sent, verification delayed')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockRetryArticleTipVerification).toHaveBeenCalledWith({
        tipId: 'tip-id',
      })
    })
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(2)
    expect(mockSubmitTipTransaction).toHaveBeenNthCalledWith(2, 'signed-xdr')
    expect(mockSubmitArticleTip).toHaveBeenCalledTimes(2)
  })

  it('offers Start over after permanent verification failure without retrying or paying again', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:abc' as never,
      authorName: 'Author',
      authorStellarAddress: 'GABC',
    }
    const { rerender } = render(<TipButton {...props} />)

    await selectPresetAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    mockVerificationStatus.mockReturnValue({
      status: 'FAILED',
      failureReason: 'article_mismatch',
      verifiedAt: undefined,
    })
    rerender(<TipButton {...props} />)

    const startOver = await screen.findByRole('button', { name: 'Start over' })
    await user.click(startOver)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(mockRetryArticleTipVerification).not.toHaveBeenCalled()
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
  })
})
