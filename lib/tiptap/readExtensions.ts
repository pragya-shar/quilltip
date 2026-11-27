import { Extension, Node, mergeAttributes } from '@tiptap/core'
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
      // Set by markBodyImagesLazy for images below the opening blocks.
      loading: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]:not([src^="data:"])' }]
  },
  renderHTML({ HTMLAttributes }) {
    const image: DOMOutputSpec = [
      'img',
      mergeAttributes(
        HTMLAttributes,
        HTMLAttributes.loading === 'lazy' ? { decoding: 'async' } : {}
      ),
    ]
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

/**
 * A paragraph's reading anchor (`lib/tiptap/readAnchors.ts`): set only by
 * the reading view's renderer, rendered as the paragraph's `id`. Never
 * parsed from HTML, so the editor never stores one.
 */
const ParagraphAnchor = Extension.create({
  name: 'paragraphAnchor',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          anchor: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attributes) =>
              typeof attributes.anchor === 'string'
                ? { id: attributes.anchor }
                : {},
          },
        },
      },
    ]
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
    ParagraphAnchor,
  ]
}
