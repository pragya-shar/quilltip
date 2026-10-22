import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from '@/lib/lowlight'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'

/** Read-only image node matching editor `resizableImage` output (no React node view). */
const ReadOnlyResizableImage = Node.create({
  name: 'resizableImage',
  group: 'block',
  draggable: false,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]:not([src^="data:"])' }]
  },
  renderHTML({ HTMLAttributes }) {
    const image: DOMOutputSpec = ['img', mergeAttributes(HTMLAttributes)]
    return HTMLAttributes.title
      ? [
          'figure',
          {},
          image,
          [
            'figcaption',
            { contenteditable: 'false' },
            String(HTMLAttributes.title),
          ],
        ]
      : image
  },
})

export function getReadOnlyExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Underline,
    Link.configure({
      openOnClick: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    CodeBlockLowlight.configure({
      lowlight,
    }),
    ReadOnlyResizableImage,
    createYoutubeExtension(),
  ]
}
