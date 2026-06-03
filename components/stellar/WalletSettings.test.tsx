/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSettings } from '@/components/stellar/WalletSettings'

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isLoading: false,
    connect: mockConnect,
    disconnect: mockDisconnect,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

vi.mock('@/components/stellar/InstallWalletDialog', () => ({
  InstallWalletDialog: () => null,
}))

vi.mock('@/components/legal/LegalLinks', () => ({
  LegalLinks: () => null,
}))

describe('WalletSettings', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockDisconnect.mockReset()
  })

  it('shows visitor empty alert with profile display name', () => {
    render(
      <WalletSettings
        isOwnProfile={false}
        walletAddress={null}
        profileDisplayName="alice"
      />
    )

    expect(
      screen.getByText(
        "alice hasn't connected a wallet yet, so in-app tipping isn't available."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('falls back to generic visitor empty alert without profile display name', () => {
    render(<WalletSettings isOwnProfile={false} walletAddress={null} />)

    expect(
      screen.getByText(
        "This author hasn't connected a wallet yet, so in-app tipping isn't available."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('shows browse articles link when profile username is provided', () => {
    render(
      <WalletSettings
        isOwnProfile={false}
        walletAddress={null}
        profileUsername="alice"
      />
    )

    expect(
      screen.getByRole('link', { name: /Browse articles/i })
    ).toHaveAttribute('href', '/alice?tab=articles')
  })

  it('shows owner connect CTA when wallet address is missing', () => {
    render(<WalletSettings isOwnProfile walletAddress={null} />)

    expect(
      screen.getByRole('button', { name: /Connect Stellar Wallet/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Connect your Stellar testnet wallet to send and receive tips/i
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('shows persistent alert when connect fails', async () => {
    mockConnect.mockRejectedValue(new Error('User rejected'))
    const user = userEvent.setup({ delay: null })

    render(<WalletSettings isOwnProfile walletAddress={null} />)

    await user.click(
      screen.getByRole('button', { name: /Connect Stellar Wallet/i })
    )

    await waitFor(() => {
      expect(screen.getByText('User rejected')).toBeInTheDocument()
    })
  })
})
