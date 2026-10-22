/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ArticleReadOnlyBody } from './ArticleReadOnlyBody'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import HighlightExtension from '@/components/editor/extensions/HighlightExtension'
import {
  HighlightConverter,
  type HighlightData,
} from '@/lib/highlights/HighlightConverter'
import type { Id } from '@/convex/_generated/dataModel'

const content: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
    {
      type: 'resizableImage',
      attrs: {
        src: 'https://example.com/photo.jpg',
        alt: 'A window',
        title: 'Morning <light> & quiet',
        width: 400,
        height: 300,
      },
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'After passage.' }] },
  ],
}

afterEach(cleanup)

it('renders the saved image caption as text in the static published reader', () => {
  const { container } = render(<ArticleReadOnlyBody content={content} />)
  const caption = screen.getByText('Morning <light> & quiet')
  expect(caption.tagName).toBe('FIGCAPTION')
  expect(caption.closest('figure')).toContainElement(
    screen.getByAltText('A window')
  )
  expect(container.querySelector('light')).toBeNull()
})

it('keeps captions out of body offsets and restores a passage after the image in the interactive reader', async () => {
  let activeEditor: Editor | null = null
  function Reader() {
    const editor = useEditor({
      extensions: [StarterKit, ResizableImage, HighlightExtension],
      content,
      editable: false,
      immediatelyRender: false,
    })
    activeEditor = editor
    return <EditorContent editor={editor} />
  }
  const { container } = render(<Reader />)
  await waitFor(() =>
    expect(screen.getByText('Morning <light> & quiet')).toBeInTheDocument()
  )
  const editor = activeEditor!
  const caption = screen.getByText('Morning <light> & quiet')
  expect(caption.tagName).toBe('FIGCAPTION')
  expect(caption).toHaveAttribute('contenteditable', 'false')
  expect(editor.state.doc.textContent).toBe('Before.After passage.')

  // These saved offsets count body text only, exactly as before captions were visible.
  const saved = {
    _id: 'saved-highlight' as Id<'highlights'>,
    text: 'passage',
    startOffset: 13,
    endOffset: 20,
    startContainerPath: '',
    endContainerPath: '',
    isPublic: true,
    userId: 'reader' as Id<'users'>,
    createdAt: 1,
  } satisfies HighlightData
  act(() => HighlightConverter.applyHighlightsToEditor(editor, [saved]))
  await waitFor(() =>
    expect(
      container.querySelector('[data-highlight-id="saved-highlight"]')
    ).toHaveTextContent('passage')
  )
  const selected = HighlightConverter.createHighlightFromSelection(editor, {})
  expect(selected).toMatchObject({
    text: 'passage',
    startOffset: 13,
    endOffset: 20,
  })
  expect(caption.closest('[data-highlight-id]')).toBeNull()
})
