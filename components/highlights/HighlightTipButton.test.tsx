/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react'
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
const mockSubmitTipTransaction = vi.hoisted(() => vi.fn())

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

  it('prepares trusted wallet fields, persists before submit, and keeps PENDING out of success', async () => {
    mockAuth.isAuthenticated = true
    mockIsConnected.mockReturnValue(true)
    mockSubmitHighlightTip.mockImplementation(async () => {
      const stored = JSON.parse(
        window.localStorage.getItem('quilltip:pendingHighlightTipReceipts') ??
          '[]'
      )
      expect(stored).toEqual([
        expect.objectContaining({
          articleId: 'articles:123',
          highlightId: 'server-highlight-id',
          tipperId: 'users:one',
          intentId: 'intent-id',
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

    expect(await screen.findByText(/verification delayed/i)).toBeInTheDocument()
    expect(screen.queryByText(/Successfully tipped/i)).not.toBeInTheDocument()
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
    expect(mockSubmitHighlightTip).toHaveBeenCalledWith({
      intentId: 'intent-id',
      stellarTxId: 'tx-highlight-123456789',
      stellarLedger: undefined,
      stellarFeeCharged: undefined,
      contractTipId: 'contract-tip-highlight',
    })
    expect(mockPrepareHighlightTip.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildHighlightTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(
      mockBuildHighlightTipTransaction.mock.invocationCallOrder[0]
    ).toBeLessThan(mockSignTransaction.mock.invocationCallOrder[0]!)
    expect(mockSignTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitTipTransaction.mock.invocationCallOrder[0]!
    )
    expect(mockSubmitTipTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitHighlightTip.mock.invocationCallOrder[0]!
    )
    expect(mockStatusQueryArgs).toHaveBeenCalledWith({
      tipId: 'highlight-tip-id',
    })

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(mockRetryHighlightTipVerification).toHaveBeenCalledWith({
        tipId: 'highlight-tip-id',
      })
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })
    expect(mockSubmitHighlightTip).toHaveBeenCalledTimes(1)
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
      await screen.findByText('Tip sent, app sync failed')
    ).toBeInTheDocument()
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSubmitTipTransaction).toHaveBeenCalledTimes(1)

    firstRender.unmount()
    render(<HighlightTipButton {...props} />)

    expect(
      await screen.findByText('Tip sent, app sync failed')
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
    expect(await screen.findByText(/verification delayed/i)).toBeInTheDocument()
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
      await screen.findByText('Tip sent, app sync failed')
    ).toBeInTheDocument()

    firstRender.unmount()
    mockStatusQueryArgs.mockClear()
    mockAuth.userId = 'users:two'
    render(<HighlightTipButton {...props} />)

    await waitFor(() => {
      expect(mockStatusQueryArgs).toHaveBeenLastCalledWith('skip')
    })
    expect(
      screen.queryByText('Tip sent, app sync failed')
    ).not.toBeInTheDocument()
    expect(
      window.localStorage.getItem('quilltip:pendingHighlightTipReceipts')
    ).toContain('users:one')
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
    expect(await screen.findByText(/verification delayed/i)).toBeInTheDocument()
    expect(
      window.localStorage.getItem('quilltip:pendingHighlightTipReceipts')
    ).toContain('tx-highlight-123456789')

    mockHighlightTipStatus.mockReturnValue({
      status: 'CONFIRMED',
      failureReason: undefined,
      verifiedAt: Date.now(),
    })
    view.rerender(<HighlightTipButton {...props} />)

    expect(await screen.findByText(/Successfully tipped/i)).toBeInTheDocument()
    expect(
      window.localStorage.getItem('quilltip:pendingHighlightTipReceipts')
    ).toBe('[]')
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
    expect(await screen.findByText(/verification delayed/i)).toBeInTheDocument()

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
    expect(
      window.localStorage.getItem('quilltip:pendingHighlightTipReceipts')
    ).toBeNull()
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
