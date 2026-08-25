/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  isLoading: false,
  userId: 'users:one',
}))
const mockIsConnected = vi.hoisted(() => vi.fn(() => false))
const mockCanTipQuery = vi.hoisted(() => vi.fn())
const mockPrepareHighlightTip = vi.hoisted(() => vi.fn())
const mockSubmitHighlightTip = vi.hoisted(() => vi.fn())
const mockRetryHighlightTipVerification = vi.hoisted(() => vi.fn())
const mockHighlightTipStatus = vi.hoisted(() => vi.fn())
const mockStatusQueryArgs = vi.hoisted(() => vi.fn())
const mockMutation = vi.hoisted(() =>
  vi.fn((args: Record<string, unknown>) => {
    if ('intentId' in args) return mockSubmitHighlightTip(args)
    if ('tipId' in args) return mockRetryHighlightTipVerification(args)
    return mockPrepareHighlightTip(args)
  })
)
const mockSignTransaction = vi.hoisted(() => vi.fn())
const mockConnect = vi.hoisted(() => vi.fn())
const mockBuildHighlightTipTransaction = vi.hoisted(() => vi.fn())
const mockDeriveTipTransactionHash = vi.hoisted(() => vi.fn())
const mockSubmitTipTransaction = vi.hoisted(() => vi.fn())
const mockPaymentLockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockAuth.isAuthenticated,
    isLoading: mockAuth.isLoading,
    user: mockAuth.isAuthenticated
      ? { _id: mockAuth.userId, username: 'reader' }
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
  useWalletActivation: () => ({ activateWallet: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/author/my-article',
}))

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockCanTipQuery }),
  useMutation: () => mockMutation,
  useQuery: (_query: unknown, args: unknown) => {
    mockStatusQueryArgs(args)
    return args === 'skip' ? undefined : mockHighlightTipStatus()
  },
}))

vi.mock('@/hooks/useTipDialogXlmUsdRate', () => ({
  useTipDialogXlmUsdRate: () => ({ priceUsd: 0.12 }),
}))

vi.mock('@/lib/stellar/client', () => ({
  stellarClient: {
    buildHighlightTipTransaction: (...args: unknown[]) =>
      mockBuildHighlightTipTransaction(...args),
    deriveTipTransactionHash: (...args: unknown[]) =>
      mockDeriveTipTransactionHash(...args),
    submitTipTransaction: (...args: unknown[]) =>
      mockSubmitTipTransaction(...args),
  },
}))

vi.mock('@/lib/stellar/config', () => ({
  STELLAR_CONFIG: { NETWORK: 'TESTNET' },
}))

vi.mock('@/lib/stellar/highlight-utils', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/stellar/highlight-utils')
  >('@/lib/stellar/highlight-utils')
  return {
    ...actual,
    generateHighlightId: vi.fn().mockResolvedValue('server-highlight-id'),
  }
})

vi.mock('@/lib/stellar/stellar-flow-emitter', () => ({
  stellarFlowEmitter: { subscribe: () => () => {}, emit: vi.fn() },
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

function getStoredHighlightReceipts(): unknown[] {
  const values: unknown[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith('quilltip:pendingHighlightTipReceipt:')) continue
    values.push(JSON.parse(window.localStorage.getItem(key) ?? 'null'))
  }
  return values
}

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
    window.localStorage.clear()
    mockPaymentLockRequest.mockReset()
    mockPaymentLockRequest.mockImplementation(
      (
        name: string,
        _options: unknown,
        callback: (lock: { name: string; mode: 'exclusive' }) => unknown
      ) => Promise.resolve(callback({ name, mode: 'exclusive' }))
    )
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: { request: mockPaymentLockRequest },
    })
    mockAuth.isAuthenticated = false
    mockAuth.isLoading = false
    mockAuth.userId = 'users:one'
    mockIsConnected.mockReturnValue(false)
    writePendingHighlightSelection.mockClear()
    signInToTip.mockClear()
    mockCanTipQuery.mockReset()
    mockCanTipQuery.mockResolvedValue({ allowed: true })
    mockMutation.mockClear()
    mockPrepareHighlightTip.mockReset()
    mockPrepareHighlightTip.mockResolvedValue({
      intentId: 'intent-id',
      highlightId: 'server-highlight-id',
      articleSymbol: 'server1234',
      authorAddress: 'GSERVERAUTHOR',
      amountStroops: 12_345_678,
      stellarNetwork: 'TESTNET',
      contractId: 'CSERVERCONTRACT',
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
    })
    mockSubmitHighlightTip.mockReset()
    mockSubmitHighlightTip.mockResolvedValue('highlight-tip-id')
    mockRetryHighlightTipVerification.mockReset()
    mockRetryHighlightTipVerification.mockResolvedValue(null)
    mockHighlightTipStatus.mockReset()
    mockHighlightTipStatus.mockReturnValue({
      status: 'PENDING',
      failureReason: undefined,
      verifiedAt: undefined,
    })
    mockStatusQueryArgs.mockClear()
    mockSignTransaction.mockReset()
    mockSignTransaction.mockResolvedValue('signed-xdr')
    mockConnect.mockReset()
    mockBuildHighlightTipTransaction.mockReset()
    mockBuildHighlightTipTransaction.mockResolvedValue({
      xdr: 'unsigned-xdr',
      stroops: 10_000_000,
      platformFee: 0.01,
      authorReceived: 0.99,
    })
    mockDeriveTipTransactionHash.mockReset()
    mockDeriveTipTransactionHash.mockResolvedValue('tx-highlight-123456789')
    mockSubmitTipTransaction.mockReset()
    mockSubmitTipTransaction.mockResolvedValue({
      transactionHash: 'tx-highlight-123456789',
      tipId: 'contract-tip-highlight',
    })
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
        startContainerPath="text.12"
        endContainerPath="text.22"
        selectionStartPosition={12}
        selectionEndPosition={22}
      />
    )

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Sign in to tip' }))

    expect(writePendingHighlightSelection).toHaveBeenCalledWith({
      articleId: 'articles:123',
      highlightText: 'Some highlighted text',
      startOffset: 12,
      endOffset: 22,
    })
    expect(signInToTip).toHaveBeenCalledWith(
      expect.anything(),
      '/author/my-article',
      expect.anything(),
      expect.objectContaining({
        startOffset: 10,
        endOffset: 20,
        startContainerPath: 'text.12',
        endContainerPath: 'text.22',
      })
    )
  })

  it('opens at checkout on resume with Sign in to tip visible', async () => {
    mockAuth.isAuthenticated = false
    await act(async () => {
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
    })

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

  it('prepares trusted wallet fields, starts verification after broadcast, and presents PENDING as progress', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSubmitHighlightTip.mockImplementationOnce(async () => {
      const stored = getStoredHighlightReceipts()
      expect(stored).toEqual([
        expect.objectContaining({
          articleId: 'articles:123',
          highlightId: 'server-highlight-id',
          tipperId: 'users:one',
          intentId: 'intent-id',
          signedXdr: 'signed-xdr',
          stellarTxId: 'tx-highlight-123456789',
          stellarNetwork: 'TESTNET',
        }),
      ])
      return 'highlight-tip-id'
    })
    const user = userEvent.setup({ delay: null })
    render(
      <HighlightTipButton
        articleId={'articles:123' as never}
        articleSlug="my-article"
        authorName="Author"
        authorStellarAddress="GCLIENTAUTHOR"
        highlightText="Some highlighted text"
        startOffset={10}
        endOffset={20}
      />
    )

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()
    expect(screen.queryByText(/verification delayed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Successfully tipped/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirming on-chain' })
    ).toBeDisabled()
    expect(mockPrepareHighlightTip).toHaveBeenCalledWith({
      articleId: 'articles:123',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
      startContainerPath: undefined,
      endContainerPath: undefined,
      amountCents: 100,
      stellarSourceAccount: 'GABCDEF123456789',
    })
    expect(mockBuildHighlightTipTransaction).toHaveBeenCalledWith(
      'GABCDEF123456789',
      {
        highlightId: 'server-highlight-id',
        articleSymbol: 'server1234',
        authorAddress: 'GSERVERAUTHOR',
        amountStroops: 12_345_678,
        contractId: 'CSERVERCONTRACT',
        timeBounds: {
          minTime: '123456789',
          maxTime: '2000000000',
        },
      }
    )
    expect(mockDeriveTipTransactionHash).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitHighlightTip).toHaveBeenCalledWith({
      intentId: 'intent-id',
      stellarTxId: 'tx-highlight-123456789',
      stellarLedger: undefined,
      stellarFeeCharged: undefined,
      contractTipId: undefined,
    })
    expect(mockPrepareHighlightTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildHighlightTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(
      mockBuildHighlightTipTransaction.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSignTransaction.mock.invocationCallOrder[0]!)
    expect(mockSignTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeriveTipTransactionHash.mock.invocationCallOrder[0]!
    )
    expect(
      mockDeriveTipTransactionHash.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSubmitHighlightTip.mock.invocationCallOrder[0]!)
    expect(mockSubmitHighlightTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitTipTransaction.mock.invocationCallOrder[0]!
    )
    await waitFor(() => {
      expect(mockRetryHighlightTipVerification).toHaveBeenCalledWith({
        tipId: 'highlight-tip-id',
      })
    })
    expect(mockSubmitTipTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockRetryHighlightTipVerification.mock.invocationCallOrder[0]!
    )
    expect(mockStatusQueryArgs).toHaveBeenCalledWith({
      tipId: 'highlight-tip-id',
    })
    expect(mockSubmitHighlightTip).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
  })

  it('shows a warning and enables a status check only after verification stays pending', async () => {
    try {
      mockAuth.isAuthenticated = true
      mockIsConnected.mockReturnValue(true)
      const user = userEvent.setup({ delay: null })
      render(
        <HighlightTipButton
          articleId={'articles:123' as never}
          articleSlug="my-article"
          authorName="Author"
          authorStellarAddress="GCLIENTAUTHOR"
          highlightText="Some highlighted text"
          startOffset={10}
          endOffset={20}
        />
      )

      await openHighlightTipAndContinue(user)
      vi.useFakeTimers()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Send Tip' }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText('Confirming on Stellar')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Confirming on-chain' })
      ).toBeDisabled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(screen.getByText('Still confirming')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()

      const verificationChecksBeforeClick =
        mockRetryHighlightTipVerification.mock.calls.length
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockRetryHighlightTipVerification).toHaveBeenCalledTimes(
        verificationChecksBeforeClick + 1
      )
      expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries Convex submission after reload without reopening the wallet', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSubmitHighlightTip
      .mockRejectedValueOnce(new Error('Convex unavailable'))
      .mockResolvedValueOnce('highlight-tip-id')
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const firstRender = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()

    firstRender.unmount()
    render(<HighlightTipButton {...props} />)

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSubmitHighlightTip).toHaveBeenCalledTimes(2)
    })
    expect(mockSubmitHighlightTip).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        intentId: 'intent-id',
        stellarTxId: 'tx-highlight-123456789',
      })
    )
    expect(mockPrepareHighlightTip).toHaveBeenCalledTimes(1)
    expect(mockBuildHighlightTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()
  })

  it('aborts before broadcast when the signed receipt cannot be durably stored', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be saved/i
    )
    expect(mockDeriveTipTransactionHash).toHaveBeenCalledWith('signed-xdr')
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(mockSubmitHighlightTip).not.toHaveBeenCalled()
  })

  it('restores an ambiguous broadcast and retries only the exact stored signed transaction', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSubmitTipTransaction
      .mockRejectedValueOnce(new Error('RPC response lost'))
      .mockResolvedValueOnce({
        transactionHash: 'tx-highlight-123456789',
      })
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const firstRender = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/retry/i)
    expect(getStoredHighlightReceipts()).toEqual([
      expect.objectContaining({
        signedXdr: 'signed-xdr',
        stellarTxId: 'tx-highlight-123456789',
      }),
    ])

    firstRender.unmount()
    mockIsConnected.mockReturnValue(false)
    render(<HighlightTipButton {...props} />)

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.getByText('Transaction source: GABCDE...456789')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Connected:/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(2)
      expect(mockSubmitHighlightTip).toHaveBeenCalledTimes(2)
    })
    expect(mockSubmitTipTransaction).toHaveBeenNthCalledWith(1, 'signed-xdr')
    expect(mockSubmitTipTransaction).toHaveBeenNthCalledWith(2, 'signed-xdr')
    expect(mockSubmitHighlightTip).toHaveBeenCalledTimes(2)
    expect(mockSubmitHighlightTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(mockSubmitHighlightTip.mock.invocationCallOrder[1]).toBeLessThan(
      mockSubmitTipTransaction.mock.invocationCallOrder[1]!
    )
    expect(mockPrepareHighlightTip).toHaveBeenCalledTimes(1)
    expect(mockBuildHighlightTipTransaction).toHaveBeenCalledTimes(1)
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not prepare a second payment when another tab stores a receipt after the dialog opens', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
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
    const { writePendingHighlightTipReceipt } =
      await import('@/lib/tip/pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt({
      articleId: 'articles:123',
      highlightId: 'server-highlight-id',
      tipperId: 'users:one' as never,
      amountCents: 100,
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GABCDEF123456789',
      intentId: 'stored-intent-id' as never,
      signedXdr: 'stored-signed-xdr',
      stellarTxId: 'tx-highlight-123456789',
    })

    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    await waitFor(() => {
      expect(mockSubmitTipTransaction).toHaveBeenCalledWith('stored-signed-xdr')
    })
    expect(mockPrepareHighlightTip).not.toHaveBeenCalled()
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitHighlightTip).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'stored-intent-id' })
    )
  })

  it('waits for the exclusive context lock and does not create or broadcast when another flow persists the matching receipt first', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    let grantLock: (() => void) | undefined
    mockPaymentLockRequest.mockImplementationOnce(
      (
        name: string,
        _options: unknown,
        callback: (lock: { name: string; mode: 'exclusive' }) => unknown
      ) =>
        new Promise((resolve, reject) => {
          grantLock = () => {
            void Promise.resolve(callback({ name, mode: 'exclusive' })).then(
              resolve,
              reject
            )
          }
        })
    )
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    await waitFor(() => {
      expect(mockPaymentLockRequest).toHaveBeenCalledWith(
        'quilltip:highlight-tip-payment:v1:users%3Aone:articles%3A123:server-highlight-id:TESTNET',
        { mode: 'exclusive' },
        expect.any(Function)
      )
    })
    const { writePendingHighlightTipReceipt } =
      await import('@/lib/tip/pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt({
      articleId: 'articles:123',
      highlightId: 'server-highlight-id',
      tipperId: 'users:one' as never,
      amountCents: 100,
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GABCDEF123456789',
      intentId: 'competing-intent-id' as never,
      signedXdr: 'competing-signed-xdr',
      stellarTxId: 'competing-transaction-hash',
    })

    await act(async () => {
      grantLock?.()
      await Promise.resolve()
    })

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    expect(mockPrepareHighlightTip).not.toHaveBeenCalled()
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
  })

  it('fails closed before preparing when the browser does not support payment locks', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not safely reserve this highlight payment/i
    )
    expect(mockPrepareHighlightTip).not.toHaveBeenCalled()
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
  })

  it('fails closed before preparing when the exclusive payment lock is unavailable', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockPaymentLockRequest.mockRejectedValueOnce(
      new Error('Lock request unavailable')
    )
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not safely reserve this highlight payment/i
    )
    expect(mockPrepareHighlightTip).not.toHaveBeenCalled()
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
  })

  it('releases the exclusive payment lock after wallet cancellation so retry can acquire it', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSignTransaction.mockRejectedValueOnce(new Error('User declined'))
    let activeLocks = 0
    let releasedLocks = 0
    mockPaymentLockRequest.mockImplementation(
      async (
        name: string,
        _options: unknown,
        callback: (lock: { name: string; mode: 'exclusive' }) => unknown
      ) => {
        expect(activeLocks).toBe(0)
        activeLocks += 1
        try {
          return await callback({ name, mode: 'exclusive' })
        } finally {
          activeLocks -= 1
          releasedLocks += 1
        }
      }
    )
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Wallet prompt was dismissed/i
    )
    expect(activeLocks).toBe(0)
    expect(releasedLocks).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
    })
    expect(mockPaymentLockRequest).toHaveBeenCalledTimes(2)
    expect(activeLocks).toBe(0)
    expect(releasedLocks).toBe(2)
  })

  it('releases the exclusive payment lock after a preparation error so retry can acquire it', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockPrepareHighlightTip.mockRejectedValueOnce(
      new Error('Preparation unavailable')
    )
    let activeLocks = 0
    let releasedLocks = 0
    mockPaymentLockRequest.mockImplementation(
      async (
        name: string,
        _options: unknown,
        callback: (lock: { name: string; mode: 'exclusive' }) => unknown
      ) => {
        expect(activeLocks).toBe(0)
        activeLocks += 1
        try {
          return await callback({ name, mode: 'exclusive' })
        } finally {
          activeLocks -= 1
          releasedLocks += 1
        }
      }
    )
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Preparation unavailable/i
    )
    expect(activeLocks).toBe(0)
    expect(releasedLocks).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(mockSubmitTipTransaction).toHaveBeenCalledWith('signed-xdr')
    })
    expect(mockPaymentLockRequest).toHaveBeenCalledTimes(2)
    expect(activeLocks).toBe(0)
    expect(releasedLocks).toBe(2)
  })

  it('recovers an existing receipt without requiring payment-lock support', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(false)
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    const { writePendingHighlightTipReceipt } =
      await import('@/lib/tip/pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt({
      articleId: 'articles:123',
      highlightId: 'server-highlight-id',
      tipperId: 'users:one' as never,
      amountCents: 100,
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GRECOVEREDSOURCE',
      intentId: 'stored-intent-id' as never,
      signedXdr: 'stored-signed-xdr',
      stellarTxId: 'stored-transaction-hash',
    })
    mockSubmitTipTransaction.mockResolvedValueOnce({
      transactionHash: 'stored-transaction-hash',
    })
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

    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(mockSubmitTipTransaction).toHaveBeenCalledWith('stored-signed-xdr')
    })
    expect(mockPrepareHighlightTip).not.toHaveBeenCalled()
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
    expect(mockPaymentLockRequest).not.toHaveBeenCalled()
  })

  it('shows neutral confirmation progress when live status is unavailable', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockHighlightTipStatus.mockReturnValue(undefined)
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirming on-chain' })
    ).toBeDisabled()
  })

  it('re-registers an unnormalized recovered ID before typed verification retry', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(false)
    mockHighlightTipStatus.mockReturnValue(undefined)
    const corruptSubmittedTipId = 'jh76g37y1p9vr3v4z5w6x7y8z9a0bcde'
    const { writePendingHighlightTipReceipt } =
      await import('@/lib/tip/pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt({
      articleId: 'articles:123',
      highlightId: 'server-highlight-id',
      tipperId: 'users:one' as never,
      amountCents: 100,
      stellarNetwork: 'TESTNET',
      stellarSourceAccount: 'GABCDEF123456789',
      intentId: 'stored-intent-id' as never,
      signedXdr: 'stored-signed-xdr',
      stellarTxId: 'tx-highlight-123456789',
      submittedTipId: corruptSubmittedTipId,
    })
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

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(mockStatusQueryArgs).toHaveBeenCalledWith({
      tipId: corruptSubmittedTipId,
    })
    expect(mockRetryHighlightTipVerification).toHaveBeenCalledWith({
      tipId: 'highlight-tip-id',
    })
    expect(mockRetryHighlightTipVerification).not.toHaveBeenCalledWith({
      tipId: corruptSubmittedTipId,
    })
  })

  it('keeps a live FAILED reason when it arrives before retry resolves', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    let resolveRetry: (() => void) | undefined
    mockRetryHighlightTipVerification.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve
        })
    )
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const view = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()

    mockHighlightTipStatus.mockReturnValue({
      status: 'FAILED',
      failureReason: 'amount_mismatch',
      verifiedAt: undefined,
    })
    view.rerender(<HighlightTipButton {...props} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'amount_mismatch'
    )

    await act(async () => {
      resolveRetry?.()
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('amount_mismatch')
    })
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'verification delayed'
    )
  })

  it('restores only the authenticated tipper receipt on a shared browser', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSubmitHighlightTip.mockRejectedValueOnce(
      new Error('Convex unavailable')
    )
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const firstRender = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(
      await screen.findByText('Tip transaction saved for recovery')
    ).toBeInTheDocument()

    firstRender.unmount()
    mockStatusQueryArgs.mockClear()
    mockAuth.userId = 'users:two'
    render(<HighlightTipButton {...props} />)

    await waitFor(() => {
      expect(mockStatusQueryArgs).toHaveBeenLastCalledWith('skip')
    })
    expect(
      screen.queryByText('Tip transaction saved for recovery')
    ).not.toBeInTheDocument()
    expect(getStoredHighlightReceipts()).toEqual([
      expect.objectContaining({ tipperId: 'users:one' }),
    ])
  })

  it('shows success and clears recovery only after caller-scoped CONFIRMED', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const view = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()
    expect(getStoredHighlightReceipts()).toEqual([
      expect.objectContaining({ stellarTxId: 'tx-highlight-123456789' }),
    ])

    mockHighlightTipStatus.mockReturnValue({
      status: 'CONFIRMED',
      failureReason: undefined,
      verifiedAt: Date.now(),
    })
    view.rerender(<HighlightTipButton {...props} />)

    expect(await screen.findByText(/Successfully tipped/i)).toBeInTheDocument()
    expect(getStoredHighlightReceipts()).toEqual([])
  })

  it('shows the caller-scoped FAILED reason without claiming writer credit', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    const user = userEvent.setup({ delay: null })
    const props = {
      articleId: 'articles:123' as never,
      articleSlug: 'my-article',
      authorName: 'Author',
      authorStellarAddress: 'GABC',
      highlightText: 'Some highlighted text',
      startOffset: 10,
      endOffset: 20,
    }
    const view = render(<HighlightTipButton {...props} />)

    await openHighlightTipAndContinue(user)
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))
    expect(await screen.findByText('Confirming on Stellar')).toBeInTheDocument()

    mockHighlightTipStatus.mockReturnValue({
      status: 'FAILED',
      failureReason: 'amount_mismatch',
      verifiedAt: undefined,
    })
    view.rerender(<HighlightTipButton {...props} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'amount_mismatch'
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/not credited/i)
    expect(screen.queryByText(/Successfully tipped/i)).not.toBeInTheDocument()
  })

  it('does not submit or persist when wallet signing is cancelled', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSignTransaction.mockRejectedValueOnce(new Error('User declined'))
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Wallet prompt was dismissed/i
    )
    expect(mockSubmitTipTransaction).not.toHaveBeenCalled()
    expect(mockSubmitHighlightTip).not.toHaveBeenCalled()
    expect(getStoredHighlightReceipts()).toEqual([])
  })

  it('does not open the wallet when the server and browser networks differ', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockPrepareHighlightTip.mockResolvedValueOnce({
      intentId: 'intent-id',
      highlightId: 'server-highlight-id',
      articleSymbol: 'server1234',
      authorAddress: 'GSERVERAUTHOR',
      amountStroops: 12_345_678,
      stellarNetwork: 'MAINNET',
      contractId: 'CSERVERCONTRACT',
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
    })
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
    await user.click(screen.getByRole('button', { name: 'Send Tip' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /network configuration does not match/i
    )
    expect(mockBuildHighlightTipTransaction).not.toHaveBeenCalled()
    expect(mockSignTransaction).not.toHaveBeenCalled()
  })
})
