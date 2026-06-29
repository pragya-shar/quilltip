/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DraftsPage from './page'
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'

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
    mockUseAuth.mockReset()
    mockUseUserDrafts.mockReset()
    mockUseUserDrafts.mockReturnValue([])
  })

  it('shows loading skeleton while auth resolves', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(<DraftsPage />)

    expect(screen.getByTestId('app-navigation')).toBeInTheDocument()
    expect(screen.queryByText('Your drafts')).not.toBeInTheDocument()
  })

  it('shows autosave guidance in the empty state only', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    render(<DraftsPage />)

    expect(screen.getByText(/No drafts yet/i)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(AUTO_SAVE_GUIDANCE))).toBeInTheDocument()
    expect(screen.queryByText(/About Drafts/i)).not.toBeInTheDocument()
  })

  it('shows start writing action in empty state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    render(<DraftsPage />)

    expect(
      screen.getByRole('link', { name: 'Start writing your first article' })
    ).toHaveAttribute('href', '/write')
  })

  it('renders document rows without visible delete buttons', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })
    mockUseUserDrafts.mockReturnValue([
      {
        _id: 'draft1',
        title: 'Test draft',
        excerpt: 'A short excerpt',
        updatedAt: Date.now(),
        _creationTime: Date.now(),
        published: false,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello world' }],
            },
          ],
        },
      },
    ])

    render(<DraftsPage />)

    expect(screen.getByRole('link', { name: /Test draft/i })).toHaveAttribute(
      'href',
      '/write?id=draft1'
    )
    expect(screen.getByText(/less than a minute ago/i)).toBeInTheDocument()
    expect(screen.getByText(/2 words/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Delete$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Actions for Test draft/i })
    ).toBeInTheDocument()
  })
})
