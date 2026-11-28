import { rangeAt } from '@/hooks/read/passageOffsets'

export type PaintedSpan = { startOffset: number; endOffset: number }

/** What this visit has to draw over the server text. */
export type PaintedLines = {
  /** The line the tip bar will tip: an ink underline (and a margin tick). */
  chosen: PaintedSpan | null
  /** Lines kept on this visit: a marker-ink underline. */
  kept: PaintedSpan[]
  /** Lines this reader tipped on this visit: full marker and a ✓. */
  tipped: PaintedSpan[]
  /** The keyboard's sentence cursor: an outline, never a choice. */
  cursor?: PaintedSpan | null
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
 * The system's mark (`PassageMark`), as plain elements over server text.
 * A tipped line says "You tipped this line" through its check's words
 * (read in every engine), not `aria-description`.
 */
const passageMark = (state: 'mine' | 'kept' | 'chosen') => () =>
  element('mark', 'qt-mark', { 'data-state': state })

/**
 * A tipped line: the system's `mine` mark (full marker), then its check in
 * marker-ink, and "You tipped this line" for screen readers. Marker on
 * paper is 1.1:1, so the fill never carries the meaning alone. The check is
 * skipped by the text offsets (`data-read-skip`), so lines chosen later
 * still line up.
 */
function markTipped(range: Range): HTMLElement[] {
  const marks = wrap(range, passageMark('mine'))
  const last = marks.at(-1)
  if (!last) return marks
  const check = element('span', 'qt-mark__check', { 'data-read-skip': '' })
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
 * Draws the chosen, kept and tipped lines and the keyboard cursor over the
 * server text, as the system's marks (`mark.qt-mark[data-state]`). While a
 * native selection is live, changing the text would disturb it, so the
 * chosen and kept lines then use custom highlights where the engine has
 * them, and nothing otherwise until the selection settles. Tipped lines are
 * drawn after acceptance, when the selection has been cleared. Returns the
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
  const selection = window.getSelection()
  const selecting =
    selection !== null &&
    !selection.isCollapsed &&
    body.contains(selection.anchorNode)
  const api = registry()
  if (selecting) {
    if (api) {
      api.highlights.set(KEPT, new api.Highlight(...lines.kept.map(toRange)))
      if (lines.chosen)
        api.highlights.set(CHOSEN, new api.Highlight(toRange(lines.chosen)))
    }
    return () => {
      api?.highlights.delete(CHOSEN)
      api?.highlights.delete(KEPT)
      unwrap(added.reverse())
    }
  }
  for (const span of lines.kept)
    added.push(...wrap(toRange(span), passageMark('kept')))
  if (lines.chosen)
    added.push(...wrap(toRange(lines.chosen), passageMark('chosen')))
  if (lines.cursor)
    added.push(
      ...wrap(toRange(lines.cursor), () => element('mark', 'qt-read__cursor'))
    )
  return () => unwrap(added.reverse())
}
