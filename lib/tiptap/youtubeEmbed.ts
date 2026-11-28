import { mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { articleEmbedSrc } from '@/lib/articles/youtubeVideo'

/**
 * How an article video renders, in the readers and in the editors: the
 * frame size and the frame's own attributes.
 */
export const YOUTUBE_EMBED_OPTIONS = {
  width: 640,
  height: 480,
  allowFullscreen: true,
  HTMLAttributes: { class: 'youtube-embed rounded-lg my-4' },
}

type EmbedOptions = {
  width: number | string
  height: number | string
  allowFullscreen: boolean
  HTMLAttributes: Record<string, unknown>
}

/** A stored width or height when it is a positive number, else the default. */
function dimension(value: unknown, fallback: number | string): number | string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

/**
 * The HTML of a video node: a frame on `articleEmbedSrc`, or a hidden,
 * empty block when the node has no video id.
 */
export function renderYoutubeEmbed(
  attrs: Record<string, unknown>,
  options: EmbedOptions = YOUTUBE_EMBED_OPTIONS
): DOMOutputSpec {
  const src = articleEmbedSrc(attrs.src, attrs.start)
  if (!src) return ['div', { 'data-youtube-video': '', hidden: 'hidden' }]
  return [
    'div',
    { 'data-youtube-video': '' },
    [
      'iframe',
      mergeAttributes(options.HTMLAttributes, {
        width: dimension(attrs.width, options.width),
        height: dimension(attrs.height, options.height),
        allowfullscreen: options.allowFullscreen,
        src,
      }),
    ],
  ]
}

/**
 * The video node for the readers (the server HTML, the client body and the
 * highlight view): the `youtube` node of `@tiptap/extension-youtube`, with
 * the same name, attributes and HTML, and nothing for editing. The editors
 * use the full extension (`lib/tiptap/youtubeExtension.ts`), so the readers'
 * first load does not carry its commands, paste rules and address helpers.
 */
export function createReaderYoutubeNode() {
  return Node.create({
    name: 'youtube',
    group: 'block',
    draggable: true,
    addAttributes() {
      return {
        src: { default: null },
        start: { default: 0 },
        width: { default: YOUTUBE_EMBED_OPTIONS.width },
        height: { default: YOUTUBE_EMBED_OPTIONS.height },
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-youtube-video] iframe' }]
    },
    renderHTML({ HTMLAttributes }) {
      return renderYoutubeEmbed(HTMLAttributes)
    },
  })
}
