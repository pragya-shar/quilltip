/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import HomePage from './page'

const useAuthMock = vi.fn()
const useCreatorWorkspaceSummaryMock = vi.fn()
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
  useCreatorWorkspaceSummary: () => useCreatorWorkspaceSummaryMock(),
  useCreatorRecentWork: () => useCreatorRecentWorkMock(),
  useAuthorEarnings: () => useAuthorEarningsMock(),
}))

describe('HomePage loading states', () => {
  beforeEach(() => {
    useAuthMock.mockReset()
    useCreatorWorkspaceSummaryMock.mockReset()
    useCreatorRecentWorkMock.mockReset()
    useAuthorEarningsMock.mockReset()
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })
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
    useCreatorWorkspaceSummaryMock.mockReset()
    useCreatorRecentWorkMock.mockReset()
    useAuthorEarningsMock.mockReset()
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })
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
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: true,
      mostRecentDraft: {
        _id: 'draft1',
        title: 'My draft',
        updatedAt: 2000,
        _creationTime: 1000,
        published: false,
      },
    })

    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /Continue writing/i })
    ).toHaveAttribute('href', '/write?id=draft1')
    expect(screen.getByText('My draft')).toBeInTheDocument()
    expect(
      screen.getByText('Your latest writing is ready when you are')
    ).toBeInTheDocument()
    expect(screen.getAllByText('Pick up where you left off')).toHaveLength(1)
  })

  it('shows Start a new article when the user has no drafts', () => {
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })

    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /Start a new article/i })
    ).toHaveAttribute('href', '/write')
    expect(screen.queryByText(/Continue writing/i)).not.toBeInTheDocument()
    expect(
      screen.getByText('Start your first article anytime')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Pick up where you left off')
    ).not.toBeInTheDocument()
  })

  it('shows the writer private total without an earnings destination', () => {
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useAuthorEarningsMock.mockReturnValue({
      totalEarnedUsd: 12.34,
      tipCount: 3,
    })

    render(<HomePage />)

    expect(screen.getByText('Total tips received')).toBeInTheDocument()
    expect(screen.getByText('$12.34')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'View earnings' })
    ).not.toBeInTheDocument()
  })

  it('uses neutral creator workspace copy while drafts are loading', () => {
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useCreatorWorkspaceSummaryMock.mockReturnValue(undefined)

    render(<HomePage />)

    expect(
      screen.getByText('Loading your writing workspace')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Pick up where you left off')
    ).not.toBeInTheDocument()
  })

  it('keeps the primary writing action when recent work fails', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    useAuthMock.mockReturnValue({
      user: baseUser,
      isAuthenticated: true,
      isLoading: false,
    })
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })
    useCreatorRecentWorkMock.mockImplementation(() => {
      throw new Error('Recent work failed')
    })

    render(<HomePage />)

    expect(
      screen.getByRole('link', { name: /Start a new article/i })
    ).toHaveAttribute('href', '/write')
    expect(screen.getByText('Workspace panel unavailable.')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
