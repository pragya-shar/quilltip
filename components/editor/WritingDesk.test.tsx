/** @vitest-environment jsdom */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { afterEach, it, expect, vi } from 'vitest'
import { WritingDesk } from './WritingDesk'
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  drafts: [{ _id: 'draft-one', title: 'My saved words', updatedAt: 1 }],
  articles: {
    articles: [
      {
        _id: 'published-one',
        title: 'A shared thought',
        slug: 'shared',
        authorUsername: 'writer',
        updatedAt: 1,
      },
    ],
    totalPages: 1,
  },
}))
vi.mock('convex/react', () => ({ useMutation: () => mocks.remove }))
vi.mock('@/hooks/convex/useArticles', () => ({
  useUserDrafts: () => mocks.drafts,
  useListArticles: () => mocks.articles,
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const props = {
  articleId: 'draft-one',
  username: 'writer',
  onNew: vi.fn(),
  onDownload: vi.fn(),
  onDeleted: vi.fn(),
  appearance: { paper: 'cream', type: 'literary', coverAlt: '' } as const,
}
it('opens exact cloud draft IDs and public article routes', () => {
  render(<WritingDesk {...props} />)
  expect(screen.getByRole('link', { name: /My saved words/ })).toHaveAttribute(
    'href',
    '/write?id=draft-one'
  )
  expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    '/write?id=published-one'
  )
  expect(screen.getByRole('link', { name: /View article/ })).toHaveAttribute(
    'href',
    '/writer/shared'
  )
})
it('requires explicit deletion and keeps the draft when the backend fails', async () => {
  mocks.remove.mockRejectedValue(new Error('Offline'))
  render(<WritingDesk {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete My saved words' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Offline')
  )
  expect(props.onDeleted).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
it('preserves deletion of published articles with an explicit permanent-storage notice', async () => {
  render(<WritingDesk {...props} />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete A shared thought' })
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('Arweave')
  expect(mocks.remove).not.toHaveBeenCalled()
})
