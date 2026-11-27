/**
 * Text offsets in the server-rendered article body. An offset counts the
 * characters of the body's text nodes in document order, with nothing
 * between blocks: the same count as the editor's document (`HighlightConverter
 * .getTextOffset`), so a passage chosen here is stored as a highlight is.
 * Image captions are an attribute in the document, not text, so they are
 * skipped.
 */
import { sentenceSpans, snapToSentences } from './sentences'

/** Rendered text that is not part of the document's text. */
export const SKIP_SELECTOR = 'figcaption, [data-read-skip]'

/** Blocks a reader can choose a line in. Headings and code are not lines. */
export const LINE_BLOCK_SELECTOR = 'p, li'

export type Passage = {
  text: string
  startOffset: number
  endOffset: number
  /** Kept for the highlight row's shape; the offsets are what count. */
  startContainerPath: string
  endContainerPath: string
}

function skipped(node: Node, root: Element): boolean {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const skip = element?.closest(SKIP_SELECTOR)
  return Boolean(skip && root.contains(skip))
}

/** The body's text nodes in document order, without skipped ones. */
export function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!skipped(node, root)) nodes.push(node as Text)
  }
  return nodes
}

/** The text offset of a DOM boundary point inside `root`, or null. */
export function offsetOf(
  root: Element,
  node: Node,
  offset: number
): number | null {
  if (!root.contains(node)) return null
  const range = root.ownerDocument.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  let total = 0
  for (const text of textNodes(root)) {
    if (text === node) return total + offset
    if (!range.intersectsNode(text)) break
    total += text.length
  }
  return total
}

/** A DOM range over `[start, end)` of the body's text, or null. */
export function rangeAt(root: Element, start: number, end: number): Range {
  const range = root.ownerDocument.createRange()
  let seen = 0
  let started = false
  const nodes = textNodes(root)
  for (const text of nodes) {
    const next = seen + text.length
    // A boundary between two nodes starts in the later one and ends in the
    // earlier one, so the range holds no empty edge.
    if (!started && start < next) {
      range.setStart(text, start - seen)
      started = true
    }
    if (started && end <= next) {
      range.setEnd(text, end - seen)
      return range
    }
    seen = next
  }
  const last = nodes.at(-1)
  if (last) range.setEnd(last, last.length)
  return range
}

/** The choosable block (paragraph or list item) around a node, if any. */
export function lineBlockOf(root: Element, node: Node): HTMLElement | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const block = element?.closest<HTMLElement>(LINE_BLOCK_SELECTOR)
  if (!block || !root.contains(block) || skipped(block, root)) return null
  // A list item holding paragraphs: the paragraph is the block.
  return block
}

/** A block's own text and where it starts in the body. */
export function blockText(
  root: Element,
  block: Element
): { start: number; text: string } {
  const nodes = textNodes(root)
  let start = 0
  let text = ''
  let found = false
  for (const node of nodes) {
    if (block.contains(node)) {
      found = true
      text += node.data
    } else if (found) break
    else start += node.length
  }
  return { start, text }
}

/**
 * The words of `[start, end)`, with a space between blocks, as the editor's
 * `textBetween(from, to, ' ')` gives them.
 */
export function textBetween(root: Element, start: number, end: number): string {
  let seen = 0
  let out = ''
  let lastBlock: Element | null = null
  for (const node of textNodes(root)) {
    const next = seen + node.length
    if (next > start && seen < end) {
      const block =
        node.parentElement?.closest('p, li, h1, h2, h3, h4, blockquote, pre') ??
        null
      if (out && lastBlock && block !== lastBlock) out += ' '
      out += node.data.slice(
        Math.max(0, start - seen),
        Math.min(node.length, end - seen)
      )
      lastBlock = block
    }
    seen = next
    if (seen >= end) break
  }
  return out
}

type Point = { node: Node; offset: number }

/**
 * The passage a tap at `from`, or a selection from `from` to `to`, chooses:
 * snapped to whole sentences, within paragraphs and list items. Null when
 * the point is not in a line (a heading, a caption, code, the margin).
 */
export function choosePassage(
  root: Element,
  from: Point,
  to: Point = from
): Passage | null {
  const startBlock = lineBlockOf(root, from.node)
  const endBlock = lineBlockOf(root, to.node)
  const startAt = offsetOf(root, from.node, from.offset)
  const endAt = offsetOf(root, to.node, to.offset)
  if (startAt === null || endAt === null) return null
  // A selection that begins or ends outside a line keeps the line it has.
  const first = startBlock ?? endBlock
  const last = endBlock ?? startBlock
  if (!first || !last) return null
  const a = blockText(root, first)
  const b = last === first ? a : blockText(root, last)
  const collapsed = startAt === endAt
  const startSnap = collapsed
    ? snapToSentences(a.text, startAt - a.start)
    : snapToSentences(
        a.text,
        Math.max(0, Math.min(startAt - a.start, a.text.length)),
        first === last
          ? Math.min(endAt - a.start, a.text.length)
          : a.text.length
      )
  const endSnap =
    collapsed || last === first
      ? startSnap
      : snapToSentences(
          b.text,
          0,
          Math.max(1, Math.min(endAt - b.start, b.text.length))
        )
  if (!startSnap || !endSnap) return null
  const startOffset = a.start + startSnap.start
  const endOffset = b.start + endSnap.end
  if (endOffset <= startOffset) return null
  return {
    text: textBetween(root, startOffset, endOffset),
    startOffset,
    endOffset,
    startContainerPath: `text.${startOffset}`,
    endContainerPath: `text.${endOffset}`,
  }
}

/**
 * The sentence at a line `y` px down the viewport: the first sentence of a
 * paragraph or list item whose last line is at or below it. Empty when no
 * line is there.
 */
export function sentenceAtLine(root: Element, y: number): string {
  const seen = new Set<Element>()
  for (const node of textNodes(root)) {
    const block = lineBlockOf(root, node)
    if (!block || seen.has(block)) continue
    seen.add(block)
    if (block.getBoundingClientRect().bottom < y) continue
    const { start, text } = blockText(root, block)
    for (const span of sentenceSpans(text)) {
      const rect = rangeAt(
        root,
        start + span.start,
        start + span.end
      ).getBoundingClientRect()
      if (rect.bottom >= y) return text.slice(span.start, span.end)
    }
  }
  return ''
}

/** The caret under a point, in engines with either API. */
export function caretAt(doc: Document, x: number, y: number): Point | null {
  const withPosition = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null
  }
  if (withPosition.caretPositionFromPoint) {
    const position = withPosition.caretPositionFromPoint(x, y)
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null
  }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null
}

/**
 * Where a passage sits, for the margin tick: the top and height of its
 * lines relative to `frame`. From the legacy popover's anchor
 * (`getRangeTopCenterAnchor`), measured against the article instead of the
 * viewport, so it scrolls with the text.
 */
export function passagePlacement(
  range: Range,
  frame: Element
): { top: number; height: number } | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  )
  if (rects.length === 0) return null
  const origin = frame.getBoundingClientRect()
  const top = Math.min(...rects.map((rect) => rect.top))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return { top: top - origin.top, height: bottom - top }
}
