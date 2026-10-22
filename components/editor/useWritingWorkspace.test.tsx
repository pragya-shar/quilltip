/** @vitest-environment jsdom */
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { getFunctionName, type FunctionReference } from 'convex/server'
import type { Doc, Id } from '@/convex/_generated/dataModel'
import { useWritingWorkspace } from './useWritingWorkspace'
import { writeDraftBackup } from '@/lib/draftBackup'
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  publish: vi.fn(),
  replace: vi.fn(),
  draft: undefined as Partial<Doc<'articles'>> | undefined,
  id: 'draft-one' as string | null,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.id ? `id=${mocks.id}` : ''),
}))
vi.mock('convex/react', () => ({
  useConvex: () => ({}),
  useMutation: (api: unknown) =>
    getFunctionName(api as FunctionReference<'mutation'>).includes(
      'publishArticle'
    )
      ? mocks.publish
      : mocks.save,
}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}))
vi.mock('@/hooks/convex/useUsers', () => ({
  useCurrentUser: () => ({
    _id: 'owner',
    username: 'writer',
    stellarAddress: 'testnet-address',
  }),
}))
vi.mock('@/hooks/convex', () => ({ useArticleById: () => mocks.draft }))
vi.mock('@/hooks/useSuspendDialogModalForWallet', () => ({
  useSuspendDialogModalForWallet: () => false,
}))
const content = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
beforeEach(() => {
  mocks.id = 'draft-one'
  mocks.draft = {
    _id: 'draft-one' as Id<'articles'>,
    authorId: 'owner' as Id<'users'>,
    title: 'Saved title',
    content: content('Saved words'),
    excerpt: 'A saved subtitle',
    updatedAt: 1,
    published: false,
  }
  mocks.save.mockReset().mockResolvedValue('draft-one')
  mocks.publish
    .mockReset()
    .mockResolvedValue({ id: 'draft-one', slug: 'published' })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})
describe('real writing controller', () => {
  it('opens publication confirmation with no subtitle', async () => {
    mocks.draft = { ...mocks.draft, excerpt: '' }
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() =>
      expect(result.current.editor?.getText()).toBe('Saved words')
    )
    act(() => result.current.requestPublish())
    expect(result.current.publishConfirmOpen).toBe(true)
  })
  it('hydrates cloud content without marking it as an edit', async () => {
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() =>
      expect(result.current.editor?.getText()).toBe('Saved words')
    )
    expect(result.current.title).toBe('Saved title')
    expect(result.current.hasUnsavedChanges).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('blocks keyboard save while the requested draft is still loading', async () => {
    mocks.draft = undefined
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() => expect(result.current.editor).toBeTruthy())
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true })
      )
    )
    expect(mocks.save).not.toHaveBeenCalled()
    expect(result.current.draftLoading).toBe(true)
  })
  it('restores newer local words without replacing them with the cloud copy', async () => {
    writeDraftBackup({
      articleId: 'draft-one',
      title: 'Recovered title',
      content: content('Recovered words'),
      excerpt: 'Recovered subtitle',
      savedAt: Date.now(),
    })
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() => expect(result.current.backupPrompt).toBeTruthy())
    act(() => result.current.handleRestoreBackup())
    await waitFor(() =>
      expect(result.current.editor?.getText()).toBe('Recovered words')
    )
    expect(result.current.title).toBe('Recovered title')
    expect(result.current.hasUnsavedChanges).toBe(true)
  })
  it('refuses to publish when saving the latest words fails', async () => {
    mocks.save.mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() =>
      expect(result.current.editor?.getText()).toBe('Saved words')
    )
    act(() => {
      result.current.editor?.commands.insertContent(' more')
      result.current.setHasUnsavedChanges(true)
    })
    await act(async () => {
      await result.current.handlePublish()
    })
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(result.current.publishSuccessVisible).toBe(false)
    expect(result.current.hasUnsavedChanges).toBe(true)
  })
  it('keeps the public status when recovering local edits of a published article', async () => {
    mocks.draft = { ...mocks.draft, published: true, publishedAt: 1 }
    writeDraftBackup({
      articleId: 'draft-one',
      title: 'Local update',
      content: content('Recovered public words'),
      excerpt: 'Updated subtitle',
      savedAt: Date.now(),
    })
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() => expect(result.current.backupPrompt).toBeTruthy())
    act(() => result.current.handleRestoreBackup())
    await waitFor(() =>
      expect(result.current.editor?.getText()).toBe('Recovered public words')
    )
    expect(result.current.publishStatus.published).toBe(true)
  })
  it('does not hydrate an article owned by someone else', async () => {
    mocks.draft = { ...mocks.draft, authorId: 'another-user' as Id<'users'> }
    const { result } = renderHook(() => useWritingWorkspace())
    await waitFor(() => expect(result.current.editor).toBeTruthy())
    expect(result.current.draftUnavailable).toBe(true)
    expect(result.current.editor?.getText()).toBe('')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
