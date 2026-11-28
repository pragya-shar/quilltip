// The article the image fixture renders (#615): an own-storage image, an
// Unsplash image and an image from an unlisted Convex deployment.
import type { JSONContent } from '@tiptap/core'

export const PAGE_PORT = 4186
export const STORAGE_PORT = 4187
/** Stands in for this deployment's own Convex origin, as a local backend. */
export const OWN_ORIGIN = `http://127.0.0.1:${STORAGE_PORT}`
export const OWN_IMAGE = `${OWN_ORIGIN}/api/storage/fixture-own-image`
export const UNSPLASH_IMAGE = 'https://images.unsplash.com/photo-fixture?w=800'
export const OTHER_CONVEX_IMAGE =
  'https://someone-else-456.convex.cloud/api/storage/fixture-other-image'

/** Profile photos (#633): uploaded, Unsplash, and on another deployment. */
export const AVATARS = {
  own: `${OWN_ORIGIN}/api/storage/fixture-own-photo`,
  unsplash: 'https://images.unsplash.com/photo-avatar?w=96',
  other:
    'https://someone-else-456.convex.cloud/api/storage/fixture-other-photo',
} as const

/** Video embeds (#633): a stored embed address with author parameters, and a playlist. */
export const VIDEO_ID = 'dQw4w9WgXcQ'
export const STORED_EMBED = `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&mute=1&loop=1`
export const PLAYLIST = `https://www.youtube.com/embed/videoseries?list=PL${VIDEO_ID}`
/** The only frame address the renderers build. */
export const REBUILT_EMBED = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=1`

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
const image = (src: string, alt: string): JSONContent => ({
  type: 'resizableImage',
  attrs: { src, alt },
})

export const article: JSONContent = {
  type: 'doc',
  content: [
    paragraph('Before the images.'),
    image(OWN_IMAGE, 'An uploaded image'),
    image(UNSPLASH_IMAGE, 'An Unsplash image'),
    image(OTHER_CONVEX_IMAGE, 'An image from another deployment'),
    { type: 'youtube', attrs: { src: STORED_EMBED } },
    { type: 'youtube', attrs: { src: PLAYLIST } },
    paragraph('After the images.'),
  ],
}
