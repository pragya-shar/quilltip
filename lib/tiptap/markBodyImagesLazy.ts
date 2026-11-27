import type { JSONContent } from '@tiptap/core'

/**
 * Top-level blocks at the start of an article that may be on the first
 * screen. Images among them load at once, since one of them can be the
 * largest paint; later images wait until the reader scrolls near them.
 */
export const EAGER_OPENING_BLOCKS = 2

/**
 * Text before the first image, in characters, up to which that image can
 * still be on the first screen of a phone (about a heading and a short
 * paragraph). An image further down stays lazy, so it does not compete with
 * the stylesheet and fonts.
 */
export const FIRST_SCREEN_TEXT_CHARS = 500

const IMAGE_NODES = new Set(['resizableImage', 'image'])

function isImage(node: JSONContent): boolean {
  return node.type !== undefined && IMAGE_NODES.has(node.type)
}

function hasImage(node: JSONContent): boolean {
  return isImage(node) || (node.content?.some(hasImage) ?? false)
}

function textLength(node: JSONContent): number {
  return (
    (node.text?.length ?? 0) +
    (node.content?.reduce((sum, child) => sum + textLength(child), 0) ?? 0)
  )
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
 * opening blocks and in the block that holds the first image when little
 * text comes before it. Below-the-fold images otherwise download with the
 * page and share a slow connection with its stylesheet and fonts. In an
 * article without a cover, an image after a heading and a short paragraph is
 * often the largest paint, so it stays eager.
 */
export function markBodyImagesLazy(doc: JSONContent): JSONContent {
  if (!doc.content) return doc
  let firstImageBlock = doc.content.findIndex(hasImage)
  const textBefore = doc.content
    .slice(0, Math.max(firstImageBlock, 0))
    .reduce((sum, block) => sum + textLength(block), 0)
  if (textBefore > FIRST_SCREEN_TEXT_CHARS) firstImageBlock = -1
  return {
    ...doc,
    content: doc.content.map((block, index) =>
      index < EAGER_OPENING_BLOCKS || index === firstImageBlock
        ? block
        : markLazy(block)
    ),
  }
}
