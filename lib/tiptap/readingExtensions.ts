import { Extension, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import Youtube from '@tiptap/extension-youtube'

/**
 * The extensions the reading view renders with, on a document already
 * reduced by `sanitizeReadingDoc`. Each renders only the attributes the
 * reading page allows: no author classes, styles or targets. Links always
 * carry `rel="noopener noreferrer nofollow ugc"` and open in the same tab.
 */

/** The editor's image, as plain HTML: a figure with its caption, or an img. */
const ReadingImage = Node.create({
  name: 'resizableImage',
  group: 'block',
  draggable: false,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null, renderHTML: () => ({}) },
      width: { default: null },
      height: { default: null },
      // Set by markBodyImagesLazy for images below the opening blocks.
      loading: { default: null },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const image: DOMOutputSpec = [
      'img',
      {
        ...HTMLAttributes,
        ...(HTMLAttributes.loading === 'lazy' ? { decoding: 'async' } : {}),
      },
    ]
    const caption = node.attrs.title
    return typeof caption === 'string' && caption
      ? ['figure', {}, image, ['figcaption', {}, caption]]
      : image
  },
})

/**
 * The reading anchor of a body paragraph (`s-{p}-0`) or a heading
 * (`h-…`), set only by the reading renderer and rendered as the `id`.
 */
const ReadingAnchor = Extension.create({
  name: 'readingAnchor',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
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

export function getReadingExtensions() {
  return [
    StarterKit.configure({ link: false }),
    Link.configure({
      openOnClick: false,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: {
        rel: 'noopener noreferrer nofollow ugc',
        target: null,
        class: null,
      },
    }),
    ReadingImage,
    Youtube.configure({
      width: 640,
      height: 360,
      controls: true,
      nocookie: true,
      allowFullscreen: true,
      HTMLAttributes: {},
    }),
    ReadingAnchor,
  ]
}
