import { mergeAttributes } from '@tiptap/core'
import Youtube from '@tiptap/extension-youtube'

/** A YouTube video id: 11 characters. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * The video id of a YouTube video address (`watch?v=`, `youtu.be/`,
 * `/embed/`, `/shorts/`, `/live/`, `/v/`), or null for anything else:
 * another host, a playlist, a channel, an id of the wrong length.
 */
export function youtubeVideoId(src: unknown): string | null {
  if (typeof src !== 'string') return null
  let url: URL
  try {
    url = new URL(src.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  let id: string | null | undefined
  if (host === 'youtu.be') {
    id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1]
  } else if (YOUTUBE_HOSTS.has(host)) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/)?.[1]
  }
  // `videoseries` is 11 characters too: the playlist player, not a video.
  return id && VIDEO_ID.test(id) && id !== 'videoseries' ? id : null
}

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
