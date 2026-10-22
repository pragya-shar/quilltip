/** @vitest-environment jsdom */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ArticleAppearance } from '@/lib/editor/articleAppearance'
import { WritingWorkspaceView } from './WritingWorkspaceView'
import type { WritingWorkspace } from './useWritingWorkspace'
vi.mock('./WritingDesk', () => ({
  WritingDesk: () => <p>Your cloud drafts</p>,
}))
vi.mock('./WritingMedia', () => ({ WritingMedia: () => null }))
vi.mock('./WritingWallet', () => ({ WritingWallet: () => null }))
vi.mock('@/components/articles/ArticleReadOnlyBody', () => ({
  ArticleReadOnlyBody: () => <p>Preview body</p>,
}))
const editors: Editor[] = []
function setup(overrides: Partial<WritingWorkspace> = {}) {
  const editor = new Editor({
    extensions: [StarterKit, ArticleAppearance],
    content: '<p>A real thought.</p>',
  })
  editors.push(editor)
  const workspace = {
    editor,
    title: 'A small observation',
    excerpt: 'A subtitle for this story',
    tags: 'Stories',
    coverImage: '',
    editorContent: editor.getJSON(),
    publishStatus: { published: false },
    currentUser: { username: 'writer' },
    saveNow: vi.fn().mockResolvedValue({ id: 'draft' }),
    setHasUnsavedChanges: vi.fn(),
    setTitle: vi.fn(),
    setExcerpt: vi.fn(),
    setTitleError: vi.fn(),
    setTags: vi.fn(),
    setCoverImage: vi.fn(),
    setWriterNotes: vi.fn(),
    requestPublish: vi.fn(),
    handlePublish: vi.fn(),
    setPublishConfirmOpen: vi.fn(),
    setPublishSuccessVisible: vi.fn(),
    setShowBodyImageDialog: vi.fn(),
    setShowBodyYouTubeDialog: vi.fn(),
    setShowCoverImageDialog: vi.fn(),
    setNavConfirm: vi.fn(),
    excerptTextareaRef: { current: null },
    hasUnsavedRef: { current: false },
    recoveryDeferredRef: { current: false },
    ...overrides,
  } as unknown as WritingWorkspace
  render(<WritingWorkspaceView workspace={workspace} />)
  return workspace
}
afterEach(() => {
  cleanup()
  editors.splice(0).forEach((e) => e.destroy())
})
describe('prototype writing workspace', () => {
  it('uses real destinations and an explicit save action', () => {
    const w = setup()
    expect(
      screen.getByRole('link', { name: 'Your library' }).getAttribute('href')
    ).toBe('/library')
    expect(
      screen.getByRole('link', { name: 'Articles' }).getAttribute('href')
    ).toBe('/articles')
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(w.saveNow).toHaveBeenCalledOnce()
  })
  it('opens preview without publishing, then opens settings before the publish confirmation', async () => {
    const w = setup()
    fireEvent.click(screen.getByRole('button', { name: /^Preview/ }))
    expect(
      await screen.findByRole('dialog', { name: 'Article preview' })
    ).toBeTruthy()
    expect(w.handlePublish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Continue to publish/ }))
    expect(
      await screen.findByRole('dialog', { name: 'Ready to share?' })
    ).toBeTruthy()
    expect(w.requestPublish).not.toHaveBeenCalled()
    expect(w.handlePublish).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Unlisted/ })).toBeDisabled()
  })
  it('stores appearance in the real editor document', async () => {
    const w = setup()
    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Sage' }))
    await waitFor(() =>
      expect(w.editor?.getJSON().attrs?.quilltipAppearance.paper).toBe('sage')
    )
  })
})

it('allows recovery actions when the original cloud draft is unavailable', () => {
  setup({
    draftUnavailable: true,
    backupPrompt: {
      articleId: 'missing',
      title: 'Local words',
      content: { type: 'doc', content: [] },
      savedAt: Date.now(),
    },
  })
  expect(
    screen.getByRole('button', { name: 'Recover as a new draft' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Download local backup' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Discard local backup' })
  ).toBeInTheDocument()
})
it('saves published article settings without offering another publication', async () => {
  const w = setup({
    publishStatus: { published: true, publishedAt: new Date() },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Preview/ }))
  expect(
    screen.queryByRole('button', { name: /Continue to publish/ })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Article settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(w.saveNow).toHaveBeenCalledOnce()
  expect(w.requestPublish).not.toHaveBeenCalled()
})
