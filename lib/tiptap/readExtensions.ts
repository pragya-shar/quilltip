import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from '@/lib/lowlight'
import { createArticleLinkExtension } from '@/lib/tiptap/articleLink'
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import {
  HIDDEN_ARTICLE_IMAGE,
  isArticleImageShown,
} from '@/lib/tiptap/articleImage'

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
    // Only this deployment's storage and the listed hosts (#615).
    if (!isArticleImageShown(HTMLAttributes.src)) {
      return [...HIDDEN_ARTICLE_IMAGE] as DOMOutputSpec
    }
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

export function getReadOnlyExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Underline,
    createArticleLinkExtension({ openOnClick: true }),
    CodeBlockLowlight.configure({
      lowlight,
    }),
    ReadOnlyResizableImage,
    createYoutubeExtension(),
  ]
}
