/**
 * Anchors into an article, one scheme for every surface that links into
 * one (Today's "Read more", the Shelf): `#s-{p}-{k}`, where `p` counts the
 * article's top-level paragraphs from 0 (headings, lists, quotes, images
 * and code are not counted) and `k` counts that paragraph's sentences from
 * 0. The server HTML gives every top-level paragraph the id `s-{p}-0`, so
 * a paragraph anchor scrolls there with no script; with scripts, the view
 * also brings a later sentence (`k` above 0) into view.
 *
 * The anchor is positional: build it from the current article's content
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

/** The paragraph number of each top-level block: null for a non-paragraph. */
export function paragraphNumbers(
  content: JSONContent | null | undefined
): (number | null)[] {
  let next = 0
  return (content?.content ?? []).map((block) =>
    block.type === 'paragraph' ? next++ : null
  )
}
