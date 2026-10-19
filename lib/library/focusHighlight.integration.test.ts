/** @vitest-environment jsdom */
import { it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CustomHighlight from '@/components/editor/extensions/HighlightExtension'
import {
  HighlightConverter,
  type HighlightData,
} from '@/lib/highlights/HighlightConverter'
import { focusLibraryHighlight } from './focusHighlight'
it('focuses the saved passage when a newer overlapping mark owns the DOM id', () => {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit, CustomHighlight.configure({ multicolor: true })],
    content: '<p>These words stay.</p>',
  })
  const highlights = [
    {
      _id: 'mine',
      text: 'These words',
      startOffset: 0,
      endOffset: 11,
      startContainerPath: '',
      endContainerPath: '',
      isPublic: true,
      userId: 'alice',
      createdAt: 1,
    },
    {
      _id: 'theirs',
      text: 'These words',
      startOffset: 0,
      endOffset: 11,
      startContainerPath: '',
      endContainerPath: '',
      isPublic: true,
      userId: 'bob',
      createdAt: 2,
    },
  ] as HighlightData[]
  HighlightConverter.applyHighlightsToEditor(editor, highlights)
  const mark = element.querySelector<HTMLElement>(
    '[data-highlight-id="theirs"]'
  )!
  mark.scrollIntoView = vi.fn()
  expect(element.querySelector('[data-highlight-id="mine"]')).toBeNull()
  expect(
    focusLibraryHighlight(element, 'mine', true, { editor, highlights })
  ).toBe(true)
  expect(mark).toHaveFocus()
  editor.destroy()
  element.remove()
})
