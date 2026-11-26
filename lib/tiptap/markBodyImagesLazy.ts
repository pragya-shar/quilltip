import type { JSONContent } from '@tiptap/core'

/**
 * Top-level blocks at the start of an article that may be on the first
 * screen. Images among them load at once, since one of them can be the
 * largest paint; later images wait until the reader scrolls near them.
 */
export const EAGER_OPENING_BLOCKS = 2

const IMAGE_NODES = new Set(['resizableImage', 'image'])

function markLazy(node: JSONContent): JSONContent {
  if (node.type && IMAGE_NODES.has(node.type)) {
    return { ...node, attrs: { ...node.attrs, loading: 'lazy' } }
  }
  if (!node.content) return node
  return { ...node, content: node.content.map(markLazy) }
}

/**
 * Returns a copy of the document in which every image after the opening
 * blocks loads lazily. Below-the-fold images otherwise download with the page
 * and share a slow connection with its stylesheet and fonts.
 */
export function markBodyImagesLazy(doc: JSONContent): JSONContent {
  if (!doc.content) return doc
  return {
    ...doc,
    content: doc.content.map((block, index) =>
      index < EAGER_OPENING_BLOCKS ? block : markLazy(block)
    ),
  }
}
