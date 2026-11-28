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
import {
  extractH2HeadingsFromTiptapJson,
  type TocHeading,
} from '@/lib/articles/toc'

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

/** A heading's id: `h-` and its table-of-contents slug, never an `s-` id. */
export function headingAnchor(slug: string): string {
  return `h-${slug}`
}

/**
 * A copy of the document with its reading anchors, unique by
 * construction: body paragraphs carry `s-{p}-0`, level-2 headings `h-` and
 * their slug (`-2`, `-3` on a repeat), and every other node carries none,
 * whatever the stored document said. Returns the headings with their ids.
 */
export function withReadingAnchors(content: JSONContent): {
  doc: JSONContent
  headings: TocHeading[]
} {
  const anchors = new Map<JSONContent, string>(
    bodyParagraphNodes(content).map((node, p) => [node, readAnchor(p)])
  )
  const toc = extractH2HeadingsFromTiptapJson(content)
  const taken = new Set<string>()
  const headings: TocHeading[] = []
  let next = 0
  const copy = (node: JSONContent): JSONContent => {
    let anchor = anchors.get(node) ?? null
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const entry = toc[next]
      // The table of contents skips headings with no text; so does this.
      const text = (node.content ?? []).map((c) => c.text ?? '').join(' ')
      if (entry && text.replace(/\s+/g, ' ').trim() !== '') {
        next++
        let id = headingAnchor(entry.id)
        for (let n = 2; taken.has(id); n++)
          id = headingAnchor(`${entry.id}-${n}`)
        taken.add(id)
        anchor = id
        headings.push({ ...entry, id })
      }
    }
    const attrs = { ...node.attrs }
    delete attrs.anchor
    if (anchor) attrs.anchor = anchor
    return {
      ...node,
      ...(Object.keys(attrs).length ? { attrs } : { attrs: undefined }),
      ...(node.content ? { content: node.content.map(copy) } : {}),
    }
  }
  return { doc: copy(content), headings }
}
