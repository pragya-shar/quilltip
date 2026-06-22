import { describe, expect, it, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import {
  ResizableImage,
  parseNumericAttr,
} from '@/components/editor/extensions/ResizableImage'

function createEditor(content?: object) {
  return new Editor({
    extensions: [Document, Paragraph, Text, ResizableImage],
    content: content ?? {
      type: 'doc',
      content: [
        {
          type: 'resizableImage',
          attrs: {
            src: 'https://example.com/photo.jpg',
            alt: 'Test alt',
            width: 450,
            height: 300,
          },
        },
      ],
    },
  })
}

describe('parseNumericAttr', () => {
  it('parses positive integers from strings and numbers', () => {
    expect(parseNumericAttr(450)).toBe(450)
    expect(parseNumericAttr('600')).toBe(600)
  })

  it('returns null for empty, zero, or invalid values', () => {
    expect(parseNumericAttr(null)).toBeNull()
    expect(parseNumericAttr('')).toBeNull()
    expect(parseNumericAttr(0)).toBeNull()
    expect(parseNumericAttr('abc')).toBeNull()
  })
})

describe('ResizableImage persistence', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  it('preserves width, height, and alt through JSON round-trip', () => {
    editor = createEditor()
    const json = editor.getJSON()
    const imageNode = json.content?.[0]
    expect(imageNode?.type).toBe('resizableImage')
    expect(imageNode?.attrs).toMatchObject({
      src: 'https://example.com/photo.jpg',
      alt: 'Test alt',
      width: 450,
      height: 300,
    })

    editor.commands.setContent({ type: 'doc', content: [] })
    editor.commands.setContent(json)

    const restored = editor.getJSON().content?.[0]
    expect(restored?.type).toBe('resizableImage')
    expect(restored?.attrs).toMatchObject({
      src: 'https://example.com/photo.jpg',
      alt: 'Test alt',
      width: 450,
      height: 300,
    })
  })

  it('selectResizableImage selects the closest image in the document', () => {
    editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'resizableImage',
          attrs: { src: 'https://example.com/x.jpg', width: 400, height: 200 },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    })
    editor.commands.setTextSelection(2)
    const selected = editor.commands.selectResizableImage()
    expect(selected).toBe(true)
    const { selection } = editor.state
    expect(selection instanceof NodeSelection).toBe(true)
    if (selection instanceof NodeSelection) {
      expect(selection.node.type.name).toBe('resizableImage')
    }
  })
})
