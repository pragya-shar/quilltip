/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CreatorWorkspace } from './CreatorWorkspace'
import type { CurrentUserDoc } from '@/types/convex'

const useCreatorWorkspaceSummaryMock = vi.fn()
const useCreatorRecentWorkMock = vi.fn()
const useAuthorEarningsMock = vi.fn()
vi.mock('@/hooks/convex', () => ({
  useCreatorWorkspaceSummary: () => useCreatorWorkspaceSummaryMock(),
  useCreatorRecentWork: () => useCreatorRecentWorkMock(),
  useAuthorEarnings: () => useAuthorEarningsMock(),
}))

describe('CreatorWorkspace', () => {
  const baseUser = {
    _id: 'user1',
    email: 'writer@example.com',
    username: 'writer',
    name: 'Writer',
    onboardingCompleted: true,
    stellarAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as CurrentUserDoc

  beforeEach(() => {
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

    render(<CreatorWorkspace user={baseUser} />)

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
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })

    render(<CreatorWorkspace user={baseUser} />)

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
    useAuthorEarningsMock.mockReturnValue({
      totalEarnedUsd: 12.34,
      tipCount: 3,
    })

    render(<CreatorWorkspace user={baseUser} />)

    expect(screen.getByText('Total tips received')).toBeInTheDocument()
    expect(screen.getByText('$12.34')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'View earnings' })
    ).not.toBeInTheDocument()
  })

  it('uses neutral creator workspace copy while drafts are loading', () => {
    useCreatorWorkspaceSummaryMock.mockReturnValue(undefined)

    render(<CreatorWorkspace user={baseUser} />)

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
    useCreatorWorkspaceSummaryMock.mockReturnValue({
      hasDrafts: false,
      mostRecentDraft: null,
    })
    useCreatorRecentWorkMock.mockImplementation(() => {
      throw new Error('Recent work failed')
    })

    render(<CreatorWorkspace user={baseUser} />)

    expect(
      screen.getByRole('link', { name: /Start a new article/i })
    ).toHaveAttribute('href', '/write')
    expect(screen.getByText('Workspace panel unavailable.')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
