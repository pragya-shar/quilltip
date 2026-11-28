import { mergeAttributes } from '@tiptap/core'
import Youtube from '@tiptap/extension-youtube'
import { youtubeVideoId } from '@/lib/articles/youtubeVideo'

export {
  youtubeVideoId,
  youtubeWatchAddress,
} from '@/lib/articles/youtubeVideo'

/**
 * The only embed address an article renders: the video's id on the
 * no-cookie host, with fixed parameters (`rel=1`, and the node's own start
 * time in whole seconds). A stored embed address is never used as it is.
 */
export function articleEmbedSrc(src: unknown, start: unknown): string | null {
  const id = youtubeVideoId(src)
  if (!id) return null
  const seconds =
    typeof start === 'number' && Number.isSafeInteger(start) && start > 0
      ? start
      : 0
  return `https://www.youtube-nocookie.com/embed/${id}?${seconds ? `start=${seconds}&` : ''}rel=1`
}

/** A stored width or height when it is a positive number, else the default. */
function dimension(value: unknown, fallback: number | string): number | string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

/**
 * The video node for article content, in the readers and in the editors.
 * It renders `articleEmbedSrc`; a node without a video id renders no frame.
 */
export function createYoutubeExtension() {
  return Youtube.extend({
    renderHTML({ HTMLAttributes }) {
      const src = articleEmbedSrc(HTMLAttributes.src, HTMLAttributes.start)
      if (!src) return ['div', { 'data-youtube-video': '', hidden: 'hidden' }]
      return [
        'div',
        { 'data-youtube-video': '' },
        [
          'iframe',
          mergeAttributes(this.options.HTMLAttributes, {
            width: dimension(HTMLAttributes.width, this.options.width),
            height: dimension(HTMLAttributes.height, this.options.height),
            allowfullscreen: this.options.allowFullscreen,
            src,
          }),
        ],
      ]
    },
  }).configure({
    width: 640,
    height: 480,
    controls: true,
    nocookie: true,
    allowFullscreen: true,
    HTMLAttributes: {
      class: 'youtube-embed rounded-lg my-4',
    },
  })
}
