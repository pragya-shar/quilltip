/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

const mockUseAuth = vi.fn()
const mockUsePathname = vi.fn()
const mockUseRedirectWhenUnauthenticated = vi.fn()

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/useRedirectWhenUnauthenticated', () => ({
  useRedirectWhenUnauthenticated: (...args: unknown[]) =>
    mockUseRedirectWhenUnauthenticated(...args),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-navigation" />,
}))

vi.mock('@/components/layout/SiteFooter', () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}))

vi.mock('@/components/dashboard/DashboardShellSkeleton', () => ({
  DashboardShellSkeleton: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="dashboard-shell-skeleton">{activeTab}</div>
  ),
}))

describe('DashboardShell', () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue('/dashboard/stats')
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('shows loading skeleton while auth resolves', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('app-navigation')).toBeInTheDocument()
    expect(screen.queryByText('Creator Dashboard')).not.toBeInTheDocument()
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
  })

  it('passes the active dashboard tab into the loading skeleton', () => {
    mockUsePathname.mockReturnValue('/dashboard/wallet')
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(screen.getByTestId('dashboard-shell-skeleton')).toHaveTextContent(
      'wallet'
    )
  })

  it('renders dashboard chrome when authenticated', () => {
    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(screen.getByText('Creator Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('offers wallet and stats without an earnings tab', () => {
    mockUsePathname.mockReturnValue('/dashboard/stats')

    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(screen.getByRole('link', { name: 'Wallet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Stats' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Earnings' })
    ).not.toBeInTheDocument()
  })

  it('returns null when unauthenticated and auth resolved', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })

    const { container } = render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(container).toBeEmptyDOMElement()
  })
})
