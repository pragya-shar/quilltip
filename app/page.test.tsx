/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import HomePage from './page'

const useAuthMock = vi.fn()
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))
vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-navigation" />,
}))
vi.mock('@/components/landing/LandingOrnaments', () => ({
  LandingOrnaments: () => null,
}))
vi.mock('@/components/landing/HeroSection', () => ({
  default: () => <div data-testid="hero-section" />,
}))
vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="landing-below-fold" />,
}))
vi.mock('@/components/landing/useLandingHashScroll', () => ({
  useLandingHashScroll: () => {},
}))
vi.mock('@/components/landing/useLandingOpening', () => ({
  useLandingOpening: () => ({ active: false, finish: vi.fn() }),
}))
vi.mock('@/components/onboarding/OnboardingIntentHome', () => ({
  OnboardingIntentHome: () => <div data-testid="onboarding-intent" />,
}))

// Fail if Home fetches the old dashboard's drafts or earnings again.
vi.mock('@/hooks/convex', () => ({
  useCreatorWorkspaceSummary: () => {
    throw new Error('Home must not load the drafts dashboard')
  },
  useCreatorRecentWork: () => {
    throw new Error('Home must not load recent work')
  },
  useAuthorEarnings: () => {
    throw new Error('Home must not load earnings')
  },
}))

describe('HomePage route continuity', () => {
  beforeEach(() => useAuthMock.mockReset())

  it.each([true, false])(
    'keeps the landing for guests (loading: %s)',
    (isLoading) => {
      useAuthMock.mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading,
      })
      render(<HomePage />)
      expect(screen.getByTestId('hero-section')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
      expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument()
    }
  )

  it('keeps the landing while the signed-in profile loads', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: true,
      isLoading: true,
    })
    render(<HomePage />)
    expect(screen.getByTestId('hero-section')).toBeInTheDocument()
    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Log in' })
    ).not.toBeInTheDocument()
  })

  it('returns existing members to the landing with their account and writing links', () => {
    useAuthMock.mockReturnValue({
      user: { onboardingCompleted: true },
      isAuthenticated: true,
      isLoading: false,
    })
    render(<HomePage />)
    expect(screen.getByTestId('hero-section')).toBeInTheDocument()
    for (const homeLink of screen.getAllByRole('link', {
      name: 'QuillTip home',
    })) {
      expect(homeLink).toHaveAttribute('href', '/')
    }
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/profile'
    )
    expect(screen.getByRole('link', { name: 'Writing desk' })).toHaveAttribute(
      'href',
      '/write'
    )
    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Sign up' })
    ).not.toBeInTheDocument()
  })

  it('preserves first-time account setup after the profile resolves', () => {
    useAuthMock.mockReturnValue({
      user: { onboardingCompleted: false },
      isAuthenticated: true,
      isLoading: false,
    })
    render(<HomePage />)
    expect(screen.getByTestId('onboarding-intent')).toBeInTheDocument()
    expect(screen.queryByTestId('hero-section')).not.toBeInTheDocument()
  })

  it('does not show onboarding from a stale profile during loading', () => {
    useAuthMock.mockReturnValue({
      user: { onboardingCompleted: false },
      isAuthenticated: true,
      isLoading: true,
    })
    render(<HomePage />)
    expect(screen.getByTestId('hero-section')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-intent')).not.toBeInTheDocument()
  })
})
