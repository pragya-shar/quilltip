/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSettings } from '@/components/stellar/WalletSettings'

const mockDisconnect = vi.fn()
const mockUpdateProfile = vi.fn()

const savedAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const nextAddress = 'GC2BKLYOOYPDEFJKLKY6FNNRQMGFLVHJKQRGNSSRRGSMPGF32LHCQVGF'

vi.mock('convex/react', () => ({
  useMutation: () => mockUpdateProfile,
}))

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: () => ({
    isLoading: false,
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

vi.mock('@/components/stellar/ContextualWalletSetup', () => ({
  ContextualWalletSetup: ({
    mode,
    recipientLabel,
  }: {
    mode: string
    recipientLabel?: string
  }) => (
    <div>
      {mode === 'send'
        ? `Connect to tip ${recipientLabel}`
        : 'Set up your receiving wallet'}
      <button type="button">Connect wallet</button>
    </div>
  ),
}))

describe('WalletSettings', () => {
  beforeEach(() => {
    mockDisconnect.mockReset()
    mockUpdateProfile.mockReset()
    mockUpdateProfile.mockResolvedValue(undefined)
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

  it('shows owner contextual wallet setup when wallet address is missing', () => {
    render(<WalletSettings isOwnProfile walletAddress={null} />)

    expect(screen.getByText('Set up your receiving wallet')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Connect wallet/i })
    ).toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
  })

  it('lets owners type and save a different receiving wallet address', async () => {
    const onAddressChange = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(
      <WalletSettings
        isOwnProfile
        walletAddress={savedAddress}
        onAddressChange={onAddressChange}
      />
    )

    const addressInput = screen.getByLabelText(/Receiving wallet address/i)
    expect(addressInput).not.toHaveAttribute('readonly')

    await user.clear(addressInput)
    await user.type(addressInput, nextAddress)

    expect(addressInput).toHaveValue(nextAddress)

    await user.click(
      screen.getByRole('button', { name: /Save receiving wallet/i })
    )

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        stellarAddress: nextAddress,
      })
      expect(onAddressChange).toHaveBeenCalledWith(nextAddress)
    })
  })
})
