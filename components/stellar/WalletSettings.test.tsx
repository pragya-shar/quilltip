/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletSettings } from '@/components/stellar/WalletSettings'

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

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

vi.mock('@/components/stellar/InstallWalletDialog', () => ({
  InstallWalletDialog: () => null,
}))

vi.mock('@/components/legal/LegalLinks', () => ({
  LegalLinks: () => null,
}))

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

describe('WalletSettings', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockDisconnect.mockReset()
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
