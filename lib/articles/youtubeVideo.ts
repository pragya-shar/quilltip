// The video id rules for article embeds (#633), shared by the renderers
// (lib/tiptap/youtubeExtension.ts) and Convex (convex/articleImageHosts.ts).
// No import, so both runtimes can use it.

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

/** The address a video is stored with: its id, on the watch page. */
export function youtubeWatchAddress(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}
