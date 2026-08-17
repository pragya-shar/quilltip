/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardShellSkeleton } from '@/components/dashboard/DashboardShellSkeleton'

vi.mock('@/components/dashboard/DashboardWalletSkeleton', () => ({
  DashboardWalletSkeleton: () => (
    <div data-testid="dashboard-wallet-skeleton" />
  ),
}))

vi.mock('@/components/dashboard/DashboardStatsSkeleton', () => ({
  DashboardStatsSkeleton: () => <div data-testid="dashboard-stats-skeleton" />,
}))

describe('DashboardShellSkeleton', () => {
  it('renders the wallet skeleton when wallet is active', () => {
    render(<DashboardShellSkeleton activeTab="wallet" />)

    expect(screen.getByTestId('dashboard-wallet-skeleton')).toBeInTheDocument()
  })

  it('renders the stats skeleton when stats is active', () => {
    render(<DashboardShellSkeleton activeTab="stats" />)

    expect(screen.getByTestId('dashboard-stats-skeleton')).toBeInTheDocument()
  })
})
