/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import HomePage from './page'

const useAuthMock = vi.fn()
const useUserDraftsMock = vi.fn()
const useCreatorRecentWorkMock = vi.fn()
const useAuthorEarningsMock = vi.fn()

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

vi.mock('@/components/onboarding/OnboardingIntentHome', () => ({
  OnboardingIntentHome: () => null,
}))

vi.mock('@/hooks/convex', () => ({
  useUserDrafts: () => useUserDraftsMock(),
  useCreatorRecentWork: () => useCreatorRecentWorkMock(),
  useAuthorEarnings: () => useAuthorEarningsMock(),
}))

describe('HomePage loading states', () => {
  beforeEach(() => {
    useAuthMock.mockReset()
    useUserDraftsMock.mockReset()
    useCreatorRecentWorkMock.mockReset()
    useAuthorEarningsMock.mockReset()
    useCreatorRecentWorkMock.mockReturnValue([])
    useAuthorEarningsMock.mockReturnValue(null)
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

describe('HomePage creator workspace', () => {
  const baseUser = {
    _id: 'user1',
    email: 'writer@example.com',
    username: 'writer',
    name: 'Writer',
    onboardingCompleted: true,
    stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    useAuthMock.mockReset()
    useUserDraftsMock.mockReset()
    useCreatorRecentWorkMock.mockReset()
    useAuthorEarningsMock.mockReset()
    useCreatorRecentWorkMock.mockReturnValue([])
    useAuthorEarningsMock.mockReturnValue({
      totalEarnedUsd: 0,
      tipCount: 0,
    })
  })

  it('shows Continue writing when the user has drafts', () => {
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useUserDraftsMock.mockReturnValue([
      {
        _id: 'draft1',
        title: 'My draft',
        updatedAt: 2000,
        _creationTime: 1000,
        published: false,
      },
      {
        _id: 'draft2',
        title: 'Older draft',
        updatedAt: 1000,
        _creationTime: 500,
        published: false,
      },
    ])

    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /Continue writing/i })
    ).toHaveAttribute('href', '/write?id=draft1')
    expect(screen.getByText('My draft')).toBeInTheDocument()
  })

  it('shows Start a new article when the user has no drafts', () => {
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useUserDraftsMock.mockReturnValue([])

    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /Start a new article/i })
    ).toHaveAttribute('href', '/write')
    expect(screen.queryByText(/Continue writing/i)).not.toBeInTheDocument()
  })
})
