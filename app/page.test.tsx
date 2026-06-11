/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
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

vi.mock('@/components/landing/Navigation', () => ({
  default: () => <nav data-testid="public-navigation" />,
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

vi.mock('@/components/onboarding/OnboardingDialog', () => ({
  OnboardingDialog: () => null,
}))

vi.mock('@/components/articles/HomeRecentArticlesSection', () => ({
  HomeRecentArticlesSection: () => null,
}))

vi.mock('@/components/error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

describe('HomePage loading states', () => {
  beforeEach(() => {
    useAuthMock.mockReset()
  })

  it('shows the public landing while auth is bootstrapping for guests', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    })

    render(<HomePage />)

    expect(screen.getByTestId('public-navigation')).toBeInTheDocument()
    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument()
  })

  it('shows the signed-in loading shell when authenticated profile is loading', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: true,
      isLoading: true,
    })

    render(<HomePage />)

    expect(screen.getByTestId('app-navigation')).toBeInTheDocument()
    expect(screen.queryByTestId('public-navigation')).not.toBeInTheDocument()
  })

  it('shows the public landing for resolved guests', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })

    render(<HomePage />)

    expect(screen.getByTestId('public-navigation')).toBeInTheDocument()
    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument()
  })
})
