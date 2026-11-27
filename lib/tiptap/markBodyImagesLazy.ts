import type { JSONContent } from '@tiptap/core'

/**
 * Top-level blocks at the start of an article that may be on the first
 * screen. Images among them load at once, since one of them can be the
 * largest paint; later images wait until the reader scrolls near them.
 */
export const EAGER_OPENING_BLOCKS = 2

const IMAGE_NODES = new Set(['resizableImage', 'image'])

function isImage(node: JSONContent): boolean {
  return node.type !== undefined && IMAGE_NODES.has(node.type)
}

function hasImage(node: JSONContent): boolean {
  return isImage(node) || (node.content?.some(hasImage) ?? false)
}

function markLazy(node: JSONContent): JSONContent {
  if (isImage(node)) {
    return { ...node, attrs: { ...node.attrs, loading: 'lazy' } }
  }
  if (!node.content) return node
  return { ...node, content: node.content.map(markLazy) }
}

/**
 * Returns a copy of the document in which images load lazily, except in the
 * opening blocks and in the block that holds the first image. Below-the-fold
 * images otherwise download with the page and share a slow connection with
 * its stylesheet and fonts. The first image stays eager wherever it is: in an
 * article without a cover it is often the largest paint (for example after a
 * heading and one short paragraph).
 */
export function markBodyImagesLazy(doc: JSONContent): JSONContent {
  if (!doc.content) return doc
  const firstImageBlock = doc.content.findIndex(hasImage)
  return {
    ...doc,
    content: doc.content.map((block, index) =>
      index < EAGER_OPENING_BLOCKS || index === firstImageBlock
        ? block
        : markLazy(block)
    ),
  }
}
