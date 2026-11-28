import { Extension, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import {
  ARTICLE_LINK_REL,
  YOUTUBE_EMBED,
} from '@/lib/tiptap/sanitizeReadingDoc'

/**
 * The extensions the reading view renders with, on a document already
 * reduced by `sanitizeReadingDoc`. Each renders only the attributes the
 * reading page allows: no author classes, styles or targets. Links always
 * carry `ARTICLE_LINK_REL` and open in place, in the same tab.
 * Images and embeds render a fixed set of attributes, written here, and
 * headings render only levels 2 to 4.
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
      title: { default: null },
      width: { default: null },
      height: { default: null },
      // Set by the sanitiser on every image after the first.
      loading: { default: null },
    }
  },
  renderHTML({ node }) {
    const { src, alt, title, width, height, loading } = node.attrs
    const image: DOMOutputSpec = [
      'img',
      {
        src,
        ...(alt ? { alt } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(loading === 'lazy' ? { loading: 'lazy', decoding: 'async' } : {}),
        referrerpolicy: 'no-referrer',
      },
    ]
    return typeof title === 'string' && title
      ? ['figure', {}, image, ['figcaption', {}, title]]
      : image
  },
})

/**
 * A YouTube video, from the address the sanitiser rebuilt from its id. The
 * frame's attributes are fixed here: lazy, sandboxed to what the player
 * needs, and with a referrer policy that sends only the origin.
 */
const ReadingVideo = Node.create({
  name: 'youtube',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return { src: { default: null } }
  },
  renderHTML({ node }) {
    const src = node.attrs.src
    if (typeof src !== 'string' || !YOUTUBE_EMBED.test(src))
      return ['div', { 'data-youtube-video': '' }]
    return [
      'div',
      { 'data-youtube-video': '' },
      [
        'iframe',
        {
          src,
          title: 'YouTube video',
          width: '640',
          height: '360',
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
          sandbox: 'allow-scripts allow-same-origin allow-presentation',
          allow: 'encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: 'true',
        },
      ],
    ]
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
    StarterKit.configure({ link: false, heading: { levels: [2, 3, 4] } }),
    Link.configure({
      openOnClick: false,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: {
        rel: ARTICLE_LINK_REL,
        // Every article link opens in place.
        target: null,
        class: null,
      },
    }),
    ReadingImage,
    ReadingVideo,
    ReadingAnchor,
  ]
}
