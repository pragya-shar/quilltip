/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { NO_WALLET_AVAILABLE_ERROR_CODE } from '@/lib/stellar/wallet-adapter'

const mockConnect = vi.fn()
const mockUpdateProfile = vi.fn()

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
      getPublicKey: vi.fn().mockResolvedValue('G' + 'A'.repeat(55)),
    },
  }
})

describe('ContextualWalletSetup', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockUpdateProfile.mockReset()
    mockConnect.mockResolvedValue(true)
    mockUpdateProfile.mockResolvedValue(undefined)
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

    expect(screen.getByText('Connect to receive tips')).toBeInTheDocument()
    expect(
      screen.getByText(
        'When readers tip your articles, payments go to this wallet.'
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
