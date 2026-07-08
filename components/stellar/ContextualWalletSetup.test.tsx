/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { NO_WALLET_AVAILABLE_ERROR_CODE } from '@/lib/stellar/wallet-adapter'
import { toast } from 'sonner'

const mockConnect = vi.fn()
const mockUpdateProfile = vi.fn()
const mockGetPublicKey = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useMutation: () => mockUpdateProfile,
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isLoading: false,
    connect: mockConnect,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/stellar/wallet-adapter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/stellar/wallet-adapter')>()
  return {
    ...actual,
    walletAdapter: {
      getPublicKey: mockGetPublicKey,
    },
  }
})

describe('ContextualWalletSetup', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockUpdateProfile.mockReset()
    mockGetPublicKey.mockReset()
    mockConnect.mockResolvedValue(true)
    mockUpdateProfile.mockResolvedValue(undefined)
    mockGetPublicKey.mockResolvedValue('G' + 'A'.repeat(55))
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('renders send mode copy with recipient label', () => {
    render(<ContextualWalletSetup mode="send" recipientLabel="Jane Doe" />)

    expect(screen.getByText('Connect to tip Jane Doe')).toBeInTheDocument()
    expect(
      screen.getByText("You'll sign the tip in your Stellar wallet.")
    ).toBeInTheDocument()
  })

  it('renders receive mode copy', () => {
    render(<ContextualWalletSetup mode="receive" />)

    expect(screen.getByText('Set up your receiving wallet')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Published articles can receive tips after this Stellar testnet wallet is saved.'
      )
    ).toBeInTheDocument()
  })

  it('links to wallet guide as secondary help', () => {
    render(<ContextualWalletSetup mode="send" recipientLabel="Author" />)

    expect(screen.getByRole('link', { name: /Wallet guide/i })).toHaveAttribute(
      'href',
      '/guide'
    )
  })

  it('persists address in receive mode after connect', async () => {
    const onAddressSaved = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(
      <ContextualWalletSetup mode="receive" onAddressSaved={onAddressSaved} />
    )

    await user.click(screen.getByRole('button', { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        stellarAddress: 'G' + 'A'.repeat(55),
      })
      expect(onAddressSaved).toHaveBeenCalledWith('G' + 'A'.repeat(55))
    })
  })

  it('shows an error without completing receive mode when the wallet returns no public key', async () => {
    mockGetPublicKey.mockResolvedValueOnce(null)
    const onAddressSaved = vi.fn()
    const onConnected = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(
      <ContextualWalletSetup
        mode="receive"
        onAddressSaved={onAddressSaved}
        onConnected={onConnected}
      />
    )

    await user.click(screen.getByRole('button', { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Could not retrieve wallet address')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText(
        'The wallet connected but returned no public key. Try again.'
      )
    ).toBeInTheDocument()
    expect(mockUpdateProfile).not.toHaveBeenCalled()
    expect(onAddressSaved).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Could not retrieve wallet address'
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not persist address in send mode', async () => {
    const user = userEvent.setup({ delay: null })

    render(<ContextualWalletSetup mode="send" recipientLabel="Author" />)

    await user.click(screen.getByRole('button', { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })
    expect(mockUpdateProfile).not.toHaveBeenCalled()
  })

  it('opens install wallet dialog when no extension is available', async () => {
    mockConnect.mockRejectedValue(
      new Error(`${NO_WALLET_AVAILABLE_ERROR_CODE}: No wallet found`)
    )
    const user = userEvent.setup({ delay: null })

    render(<ContextualWalletSetup mode="send" recipientLabel="Author" />)

    await user.click(screen.getByRole('button', { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Install a Stellar wallet/i })
      ).toBeInTheDocument()
    })
  })
})
