/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DraftsPage from './page'

const mockUseAuth = vi.fn()
const mockUseUserDrafts = vi.fn()

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/convex', () => ({
  useUserDrafts: () => mockUseUserDrafts(),
}))

vi.mock('@/hooks/useRedirectWhenUnauthenticated', () => ({
  useRedirectWhenUnauthenticated: vi.fn(),
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-navigation" />,
}))

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
}))

describe('DraftsPage', () => {
  beforeEach(() => {
    mockUseUserDrafts.mockReturnValue([])
  })

  it('shows loading skeleton while auth resolves', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(<DraftsPage />)

    expect(screen.getByTestId('app-navigation')).toBeInTheDocument()
    expect(screen.queryByText('Your Drafts')).not.toBeInTheDocument()
  })

  it('shows start draft action in empty state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    render(<DraftsPage />)

    expect(
      screen.getByRole('heading', { name: 'No drafts yet' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a draft' })).toHaveAttribute(
      'href',
      '/write'
    )
  })
})
