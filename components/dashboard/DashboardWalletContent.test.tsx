/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardWalletContent } from '@/components/dashboard/DashboardWalletContent'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUseUserByUsername = vi.hoisted(() => vi.fn())

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/convex', () => ({
  useUserByUsername: (username: string | undefined) =>
    mockUseUserByUsername(username),
}))

vi.mock('@/components/stellar', () => ({
  WalletSettings: ({
    walletAddress,
    onAddressChange,
  }: {
    walletAddress?: string | null
    onAddressChange?: (address: string | null) => void
  }) => (
    <div>
      <p data-testid="wallet-address">{walletAddress ?? 'missing'}</p>
      <button type="button" onClick={() => onAddressChange?.(null)}>
        Disconnect wallet
      </button>
    </div>
  ),
}))

vi.mock('@/components/dashboard/DashboardWalletSkeleton', () => ({
  DashboardWalletSkeleton: () => <div data-testid="wallet-skeleton" />,
}))

describe('DashboardWalletContent', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    mockUseUserByUsername.mockReset()
    mockUseAuth.mockReturnValue({
      user: { username: 'writer' },
    })
    mockUseUserByUsername.mockReturnValue({
      username: 'writer',
      name: 'Writer',
      stellarAddress: 'GOLDADDRESS',
    })
  })

  it('does not fall back to a stale queried wallet after disconnect', async () => {
    const user = userEvent.setup({ delay: null })

    render(<DashboardWalletContent />)

    expect(screen.getByTestId('wallet-address')).toHaveTextContent(
      'GOLDADDRESS'
    )

    await user.click(screen.getByRole('button', { name: /Disconnect wallet/i }))

    expect(screen.getByTestId('wallet-address')).toHaveTextContent('missing')
  })
})
