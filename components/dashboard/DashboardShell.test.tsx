/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

const mockUseAuth = vi.fn()
const mockUseRedirectWhenUnauthenticated = vi.fn()

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/useRedirectWhenUnauthenticated', () => ({
  useRedirectWhenUnauthenticated: (...args: unknown[]) =>
    mockUseRedirectWhenUnauthenticated(...args),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/earnings',
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-navigation" />,
}))

vi.mock('@/components/layout/SiteFooter', () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}))

vi.mock('@/components/dashboard/DashboardTabBar', () => ({
  DashboardTabBar: () => <nav data-testid="dashboard-tab-bar" />,
}))

describe('DashboardShell', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
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

  it('renders dashboard chrome when authenticated', () => {
    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    )

    expect(screen.getByText('Creator Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
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
