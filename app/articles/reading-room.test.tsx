/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingRoom as ArticlesPage } from '@/components/articles/ReadingRoom'
import { readBookmarks } from '@/lib/library/bookmarks'
const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  user: null as null | { _id: string },
  result: undefined as unknown,
}))
vi.mock('@/components/articles/reading-room.css', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => state.params,
  usePathname: () => '/articles',
}))
vi.mock('@/components/landing/LandingOrnaments', () => ({
  LandingOrnaments: () => null,
}))
vi.mock('@/components/layout/AppNavigation', () => ({ default: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    isLoading: false,
    isAuthenticated: !!state.user,
  }),
}))
vi.mock('@/hooks/convex', () => ({
  useListArticles: () => state.result,
  useBrowseTags: () => [{ tag: 'nature', articleCount: 1 }],
  useBrowseAuthors: () => [{ username: 'maya', name: 'Maya', count: 1 }],
}))
const row = {
  _id: 'real-story',
  slug: 'a-real-story',
  title: 'A real story',
  excerpt: 'Words from the real article.',
  tags: ['nature'],
  readTime: 3,
  author: { id: 'maya-id', name: 'Maya', username: 'maya' },
}
beforeEach(() => {
  state.params = new URLSearchParams()
  state.push.mockClear()
  state.user = null
  state.result = { articles: [row], page: 1, limit: 9, total: 1, totalPages: 1 }
  localStorage.clear()
  history.replaceState({}, '', '/articles')
  window.scrollTo = vi.fn()
})
describe('real Articles reading room', () => {
  it('keeps guest bookmark intent attached to the real article through signup', () => {
    render(<ArticlesPage />)
    expect(
      screen.getByRole('link', { name: 'Bookmark A real story' })
    ).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fmaya%2Fa-real-story%3Fbookmark%3D1'
    )
    expect(
      screen.getByRole('link', { name: 'Read article ↗' })
    ).toHaveAttribute('href', '/maya/a-real-story')
  })
  it('saves from the card to the current account library and removes it again', () => {
    state.user = { _id: 'alice' }
    render(<ArticlesPage />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Bookmark A real story' })
    )
    expect(readBookmarks('alice').map((b) => b.id)).toEqual(['real-story'])
    expect(readBookmarks('bob')).toEqual([])
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove bookmark for A real story' })
    )
    expect(readBookmarks('alice')).toEqual([])
  })
  it('does not consume article signup intent on the listing page', () => {
    state.user = { _id: 'alice' }
    history.replaceState({}, '', '/articles?bookmark=1')
    render(<ArticlesPage />)
    expect(readBookmarks('alice')).toEqual([])
  })
  it('keeps author and sort when choosing a topic and resets pagination', () => {
    state.params = new URLSearchParams('author=maya&sort=oldest&page=4')
    render(<ArticlesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'nature' }))
    expect(state.push).toHaveBeenCalledWith(
      '/articles?author=maya&sort=oldest&tag=nature'
    )
  })
  it('cancels an unfinished search when a topic is selected', async () => {
    render(<ArticlesPage />)
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search articles' }),
      { target: { value: 'stale words' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'nature' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    expect(state.push).toHaveBeenCalledTimes(1)
    expect(state.push).toHaveBeenLastCalledWith('/articles?tag=nature')
  })
  it('clears only search from an empty result while retaining the chosen topic', () => {
    state.params = new URLSearchParams('tag=nature&search=absent')
    state.result = { articles: [], page: 1, limit: 9, total: 0, totalPages: 0 }
    render(<ArticlesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(state.push).toHaveBeenCalledWith('/articles?tag=nature')
  })
  it('shows a loading status before data arrives', () => {
    state.result = undefined
    render(<ArticlesPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading articles…')
    expect(
      screen.queryByRole('link', { name: 'Read article ↗' })
    ).not.toBeInTheDocument()
  })
  it('reveals more articles without losing query state or scrolling to the top', () => {
    state.params = new URLSearchParams('tag=nature')
    state.result = {
      articles: Array.from({ length: 4 }, (_, i) => ({
        ...row,
        _id: `story-${i}`,
        slug: `story-${i}`,
      })),
      page: 1,
      limit: 9,
      total: 4,
    }
    render(<ArticlesPage />)
    expect(
      screen.getAllByRole('link', { name: 'Read article ↗' })
    ).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(state.push).toHaveBeenCalledWith('/articles?tag=nature&count=6', {
      scroll: false,
    })
  })
  it('uses approved fallback artwork when an author image cannot load', async () => {
    state.result = {
      articles: [{ ...row, coverImage: 'https://example.com/broken.jpg' }],
      page: 1,
      limit: 9,
      total: 1,
    }
    render(<ArticlesPage />)
    const cover = screen
      .getByRole('link', { name: 'Read A real story' })
      .querySelector('img')!
    fireEvent.error(cover)
    await waitFor(() => expect(cover.src).toContain('/prototype/articles/'))
  })
  it('keeps discovery filters when advancing to the next server page', () => {
    state.params = new URLSearchParams('tag=nature&sort=oldest&count=9')
    state.result = {
      articles: Array.from({ length: 9 }, (_, i) => ({
        ...row,
        _id: `story-${i}`,
        slug: `story-${i}`,
      })),
      page: 1,
      limit: 9,
      total: 12,
      totalPages: 2,
    }
    render(<ArticlesPage />)
    expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next articles →' }))
    expect(state.push).toHaveBeenCalledWith(
      '/articles?tag=nature&sort=oldest&page=2'
    )
  })
})
