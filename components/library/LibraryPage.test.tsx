/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { LibraryPage } from './LibraryPage'
import { toggleBookmark } from '@/lib/library/bookmarks'
const state = vi.hoisted(() => ({
  auth: {
    user: null as null | { _id: string },
    isAuthenticated: false,
    isLoading: false,
  },
  highlights: [] as unknown[],
  path: '',
}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => state.auth,
}))
vi.mock('@/hooks/convex/useHighlightQueries', () => ({
  useUserHighlightsQuery: () => state.highlights,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (path: string) => {
      state.path = path
    },
  }),
}))
describe('prototype library route', () => {
  beforeEach(() => {
    localStorage.clear()
    state.auth = { user: null, isAuthenticated: false, isLoading: false }
    state.highlights = []
    state.path = ''
  })
  it('requires an account and preserves the library destination through signup', async () => {
    render(<LibraryPage />)
    await waitFor(() =>
      expect(state.path).toBe('/register?returnTo=%2Flibrary')
    )
    expect(
      screen.queryByRole('heading', { name: 'Bookmarked articles' })
    ).not.toBeInTheDocument()
  })
  it('waits for auth before redirecting', () => {
    state.auth.isLoading = true
    render(<LibraryPage />)
    expect(state.path).toBe('')
  })
  it('renders real bookmarked articles and saved highlights with navigable destinations', () => {
    state.auth = {
      user: { _id: 'alice' },
      isAuthenticated: true,
      isLoading: false,
    }
    toggleBookmark('alice', {
      id: 'story',
      title: 'A real story',
      username: 'maya',
      slug: 'real-story',
      author: 'Maya',
      topic: 'Life',
      minutes: 3,
    })
    state.highlights = [
      {
        _id: 'highlight1',
        text: 'Words that stay.',
        article: {
          title: 'A real story',
          slug: 'real-story',
          authorUsername: 'maya',
        },
      },
    ]
    render(<LibraryPage />)
    expect(
      screen.getByRole('link', { name: /Life.*A real story/ })
    ).toHaveAttribute('href', '/maya/real-story')
    expect(
      screen.getByRole('link', { name: /Words that stay/ })
    ).toHaveAttribute('href', '/maya/real-story?highlight=highlight1')
  })
})
