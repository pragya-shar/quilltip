import { rangeAt } from '@/hooks/read/passageOffsets'

export type PaintedSpan = { startOffset: number; endOffset: number }

/** What this visit has to draw over the server text (DESIGN-ZERO N5). */
export type PaintedLines = {
  /** The line the tip bar will tip: an ink underline (and a margin tick). */
  chosen: PaintedSpan | null
  /** Lines kept on this visit: a marker-ink underline. */
  kept: PaintedSpan[]
  /** Lines this reader tipped on this visit: full marker and a ✓. */
  tipped: PaintedSpan[]
}

const CHOSEN = 'qt-read-chosen'
const KEPT = 'qt-read-kept'

type HighlightRegistry = Map<string, unknown>
type HighlightConstructor = new (...ranges: Range[]) => unknown

function registry(): {
  highlights: HighlightRegistry
  Highlight: HighlightConstructor
} | null {
  const css = globalThis.CSS as unknown as
    | { highlights?: HighlightRegistry }
    | undefined
  const Highlight = (globalThis as { Highlight?: HighlightConstructor })
    .Highlight
  return css?.highlights && Highlight
    ? { highlights: css.highlights, Highlight }
    : null
}

/** Wraps a range's text nodes in elements made by `make`. */
function wrap(range: Range, make: () => HTMLElement): HTMLElement[] {
  const marks: HTMLElement[] = []
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode! : root,
    NodeFilter.SHOW_TEXT
  )
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (range.intersectsNode(node)) nodes.push(node as Text)
  for (const node of nodes) {
    let text = node
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.length
    if (end <= start) continue
    if (end < text.length) text.splitText(end)
    if (start > 0) text = text.splitText(start)
    const mark = make()
    text.replaceWith(mark)
    mark.append(text)
    marks.push(mark)
  }
  return marks
}

/** Removes what `wrap` and the ✓ added, leaving the server text as it was. */
function unwrap(added: HTMLElement[]) {
  for (const node of added) {
    const parent = node.parentNode
    if (!parent) continue
    if (node.dataset.readCheck !== undefined) node.remove()
    else node.replaceWith(...Array.from(node.childNodes))
    parent.normalize()
  }
}

const element = (
  tag: string,
  className: string,
  attrs: Record<string, string> = {}
) => {
  const node = document.createElement(tag)
  node.className = className
  node.dataset.readPaint = ''
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, value)
  return node
}

/**
 * A tipped line: the system's full marker mark, then a ✓ in marker-ink and
 * "You tipped this line" for screen readers. Marker on paper is 1.1:1, so
 * the fill never carries the meaning alone. The ✓ is skipped by the text
 * offsets (`data-read-skip`), so passages chosen later still line up.
 */
function markTipped(range: Range): HTMLElement[] {
  const marks = wrap(range, () =>
    element('mark', 'qt-mark', { 'data-heat': '3', 'data-mine': '' })
  )
  const last = marks.at(-1)
  if (!last) return marks
  const check = element('span', 'qt-read__mine', { 'data-read-skip': '' })
  check.dataset.readCheck = ''
  const glyph = document.createElement('span')
  glyph.setAttribute('aria-hidden', 'true')
  glyph.textContent = '✓'
  const words = document.createElement('span')
  words.className = 'qt-visually-hidden'
  words.textContent = ' You tipped this line.'
  check.append(glyph, words)
  last.after(check)
  return [...marks, check]
}

/**
 * Draws the chosen, kept and tipped lines over the server text. The chosen
 * and kept lines use custom highlights where the engine has them (no change
 * to the text, so a native selection is never disturbed), and marks
 * otherwise, only while no selection is live. Tipped lines are marks, drawn
 * after acceptance, when the selection has been cleared. Returns the
 * cleanup.
 */
export function paintPassages(
  body: HTMLElement,
  lines: PaintedLines
): () => void {
  const toRange = (span: PaintedSpan) =>
    rangeAt(body, span.startOffset, span.endOffset)
  const added: HTMLElement[] = lines.tipped.flatMap((span) =>
    markTipped(toRange(span))
  )
  const api = registry()
  if (api) {
    api.highlights.set(KEPT, new api.Highlight(...lines.kept.map(toRange)))
    if (lines.chosen)
      api.highlights.set(CHOSEN, new api.Highlight(toRange(lines.chosen)))
    else api.highlights.delete(CHOSEN)
    return () => {
      api.highlights.delete(CHOSEN)
      api.highlights.delete(KEPT)
      unwrap(added.reverse())
    }
  }
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    for (const span of lines.kept)
      added.push(...wrap(toRange(span), () => element('mark', 'qt-read__kept')))
    if (lines.chosen)
      added.push(
        ...wrap(toRange(lines.chosen), () => element('mark', 'qt-read__chosen'))
      )
  }
  return () => unwrap(added.reverse())
}
