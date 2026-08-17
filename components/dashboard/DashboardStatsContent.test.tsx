/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardStatsContent } from '@/components/dashboard/DashboardStatsContent'

const mockUseAuth = vi.fn()
const mockUseUserByUsername = vi.fn()
const mockUseUserStats = vi.fn()
const mockUseAuthorEarnings = vi.fn()

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/convex', () => ({
  useUserByUsername: (...args: unknown[]) => mockUseUserByUsername(...args),
  useUserStats: (...args: unknown[]) => mockUseUserStats(...args),
  useAuthorEarnings: () => mockUseAuthorEarnings(),
}))

describe('DashboardStatsContent', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { username: 'writer' } })
    mockUseUserByUsername.mockReturnValue({
      _id: 'users:writer',
      nftsOwned: 0,
    })
    mockUseUserStats.mockReturnValue({
      articleCount: 2,
      tipsReceivedCount: 3,
    })
    mockUseAuthorEarnings.mockReturnValue({ totalEarnedUsd: 12.34 })
  })

  it('shows the signed-in writer total tips received', () => {
    render(<DashboardStatsContent />)

    expect(screen.getByText('Total tips received')).toBeInTheDocument()
    expect(screen.getByText('$12.34')).toBeInTheDocument()
  })

  it('does not show a false zero while the private earnings total is loading', () => {
    mockUseAuthorEarnings.mockReturnValue(undefined)

    render(<DashboardStatsContent />)

    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByText('Creator Stats')).not.toBeInTheDocument()
  })

  it('does not show partial stats while the writer totals are loading', () => {
    mockUseUserStats.mockReturnValue(undefined)

    render(<DashboardStatsContent />)

    expect(screen.queryByText('Creator Stats')).not.toBeInTheDocument()
  })
})
