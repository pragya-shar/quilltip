/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProtectedPageShell } from '@/components/layout/ProtectedPageShell'

const mockUseRedirectWhenUnauthenticated = vi.fn()

vi.mock('@/hooks/useRedirectWhenUnauthenticated', () => ({
  useRedirectWhenUnauthenticated: (...args: unknown[]) =>
    mockUseRedirectWhenUnauthenticated(...args),
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-navigation" />,
}))

describe('ProtectedPageShell', () => {
  it('shows loading shell while auth resolves', () => {
    render(
      <ProtectedPageShell
        isLoading
        isAuthenticated={false}
        loadingContent={<div data-testid="loading-skeleton" />}
      >
        <div data-testid="page-content">Content</div>
      </ProtectedPageShell>
    )

    expect(screen.getByTestId('app-navigation')).toBeInTheDocument()
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument()
    expect(mockUseRedirectWhenUnauthenticated).toHaveBeenCalledWith(true, false)
  })

  it('renders children when authenticated', () => {
    render(
      <ProtectedPageShell
        isLoading={false}
        isAuthenticated
        loadingContent={<div data-testid="loading-skeleton" />}
      >
        <div data-testid="page-content">Content</div>
      </ProtectedPageShell>
    )

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument()
  })

  it('returns null when unauthenticated and auth resolved', () => {
    const { container } = render(
      <ProtectedPageShell
        isLoading={false}
        isAuthenticated={false}
        loadingContent={<div data-testid="loading-skeleton" />}
      >
        <div data-testid="page-content">Content</div>
      </ProtectedPageShell>
    )

    expect(container).toBeEmptyDOMElement()
  })
})
