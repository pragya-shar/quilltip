/**
 * Anchors into an article, one scheme for every surface that links into
 * one (Today's "Read more", the Shelf): `#s-{p}-{k}`.
 *
 * - `p` counts the article's body paragraphs from 0, the way Today's
 *   opening counts them (`bodyParagraphs` in convex/lib/todayOpening.ts):
 *   top-level paragraphs and the paragraphs directly inside a top-level
 *   quote, in order, skipping paragraphs with no text. Headings, lists,
 *   images, embeds and code are not counted.
 * - `k` counts that paragraph's sentences from 0 (`hooks/read/sentences`).
 *
 * The server HTML gives every body paragraph the id `s-{p}-0`, so a
 * paragraph anchor scrolls there with no script; with scripts, the view
 * also brings a later sentence (`k` above 0) into view. Nothing is chosen.
 *
 * The anchor is positional: build it from the article's current content
 * when the link is made. A shared line uses `/p/<code>` and the passage
 * identity (pull request 603), never an anchor.
 */
import type { JSONContent } from '@tiptap/core'

export function readAnchor(paragraph: number, sentence = 0): string {
  return `s-${paragraph}-${sentence}`
}

/** The paragraph and sentence of an anchor (`s-3-1` or `#s-3-1`), or null. */
export function parseReadAnchor(
  hash: string
): { paragraph: number; sentence: number } | null {
  const match = /^#?s-(\d{1,5})-(\d{1,4})$/.exec(hash)
  return match
    ? { paragraph: Number(match[1]), sentence: Number(match[2]) }
    : null
}

/** A node's text as Today reads it: hard breaks are spaces. */
function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map(textOf).join('')
}

const hasText = (node: JSONContent) =>
  textOf(node).replace(/\s+/g, ' ').trim() !== ''

/**
 * The body paragraphs in order, as the paragraph nodes themselves, so a
 * caller can mark them: `bodyParagraphNodes(doc)[p]` is paragraph `p`.
 */
export function bodyParagraphNodes(
  content: JSONContent | null | undefined
): JSONContent[] {
  const paragraphs: JSONContent[] = []
  for (const block of content?.content ?? []) {
    if (block.type === 'paragraph') {
      if (hasText(block)) paragraphs.push(block)
    } else if (block.type === 'blockquote') {
      for (const child of block.content ?? [])
        if (child.type === 'paragraph' && hasText(child)) paragraphs.push(child)
    }
  }
  return paragraphs
}

/**
 * A copy of the document whose body paragraphs carry `anchor: 's-{p}-0'`,
 * which the read-only paragraph renders as its `id`.
 */
export function withParagraphAnchors(content: JSONContent): JSONContent {
  const anchors = new Map(
    bodyParagraphNodes(content).map((node, p) => [node, readAnchor(p)])
  )
  const copy = (node: JSONContent): JSONContent => {
    const anchor = anchors.get(node)
    return {
      ...node,
      ...(anchor ? { attrs: { ...node.attrs, anchor } } : {}),
      ...(node.content ? { content: node.content.map(copy) } : {}),
    }
  }
  return copy(content)
}
