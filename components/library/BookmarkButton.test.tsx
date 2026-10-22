/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { BookmarkButton } from './BookmarkButton'
import { readBookmarks } from '@/lib/library/bookmarks'
const auth = vi.hoisted(() => ({
  user: { _id: 'alice' } as { _id: string } | null,
  isLoading: false,
}))
vi.mock('@/components/providers/AuthContext', () => ({ useAuth: () => auth }))
const article = {
  id: 'story',
  title: 'A real story',
  username: 'maya',
  slug: 'real-story',
  author: 'Maya',
  topic: 'Life',
  minutes: 3,
}
describe('article bookmarking', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState({}, '', '/maya/real-story')
    auth.user = { _id: 'alice' }
  })
  it('completes signup intent once on the individual article', () => {
    history.replaceState({}, '', '/maya/real-story?bookmark=1#passage')
    render(<BookmarkButton article={article} />)
    expect(readBookmarks('alice')).toEqual([article])
    expect(location.pathname + location.search + location.hash).toBe(
      '/maya/real-story#passage'
    )
  })
  it('saves and removes the real article without leaving the reader', async () => {
    const user = userEvent.setup()
    render(<BookmarkButton article={article} />)
    await user.click(
      screen.getByRole('button', { name: /Bookmark A real story/ })
    )
    expect(readBookmarks('alice')).toEqual([article])
    await user.click(screen.getByRole('button', { name: /Remove bookmark/ }))
    expect(readBookmarks('alice')).toEqual([])
  })
  it('offers signup with the exact article return for guests', () => {
    auth.user = null
    render(<BookmarkButton article={article} />)
    expect(screen.getByRole('link', { name: /Bookmark/ })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fmaya%2Freal-story%3Fbookmark%3D1'
    )
  })
})
