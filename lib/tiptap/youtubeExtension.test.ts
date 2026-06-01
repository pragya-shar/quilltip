import { describe, expect, it, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { generateHTML } from '@tiptap/html'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { getReadOnlyExtensions } from '@/lib/tiptap/readExtensions'

const SAMPLE_WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function createYoutubeEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, createYoutubeExtension()],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
  })
}

describe('createYoutubeExtension', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  it('inserts a youtube node from a watch URL', () => {
    editor = createYoutubeEditor()
    const ok = editor.commands.setYoutubeVideo({ src: SAMPLE_WATCH_URL })
    expect(ok).toBe(true)

    const json = editor.getJSON()
    const youtubeNode = json.content?.find((node) => node.type === 'youtube')
    expect(youtubeNode?.type).toBe('youtube')
    expect(youtubeNode?.attrs?.src).toBe(SAMPLE_WATCH_URL)
  })

  it('renders an iframe via generateHTML', () => {
    editor = createYoutubeEditor()
    editor.commands.setYoutubeVideo({ src: SAMPLE_WATCH_URL })

    const html = generateHTML(editor.getJSON(), [
      Document,
      Paragraph,
      Text,
      createYoutubeExtension(),
    ])
    expect(html).toContain('<iframe')
    expect(html).toContain('youtube-nocookie.com/embed/')
  })

  it('renders youtube nodes with read-only extensions', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'youtube',
          attrs: { src: SAMPLE_WATCH_URL },
        },
      ],
    }

    const html = generateHTML(content, getReadOnlyExtensions())
    expect(html).toContain('<iframe')
    expect(html).toMatch(/youtube-nocookie\.com\/embed\/|youtube\.com\/embed\//)
  })
})
