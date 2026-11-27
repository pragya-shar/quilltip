import { rangeAt } from '@/hooks/read/passageOffsets'

export type PaintedSpan = { startOffset: number; endOffset: number }

const CHOSEN = 'qt-read-chosen'
const TIPPED = 'qt-read-tipped'

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

/** Wraps a range's text in marks: for engines without highlights. */
function wrap(range: Range, attrs: Record<string, string>): HTMLElement[] {
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
    const mark = document.createElement('mark')
    mark.className = 'qt-mark'
    for (const [name, value] of Object.entries(attrs))
      mark.setAttribute(name, value)
    text.replaceWith(mark)
    mark.append(text)
    marks.push(mark)
  }
  return marks
}

function unwrap(marks: HTMLElement[]) {
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    mark.replaceWith(...Array.from(mark.childNodes))
    parent.normalize()
  }
}

/**
 * Draws the chosen line and the lines tipped on this visit over the server
 * text. Custom highlights where the engine has them (no change to the
 * text, so a native selection is never disturbed); marks otherwise, and
 * only while no selection is live. Colour is never the only cue: the chosen
 * line is underlined and gets a margin tick. Returns the cleanup.
 */
export function paintPassages(
  body: HTMLElement,
  chosen: PaintedSpan | null,
  tipped: PaintedSpan[]
): () => void {
  const toRange = (span: PaintedSpan) =>
    rangeAt(body, span.startOffset, span.endOffset)
  const api = registry()
  if (api) {
    api.highlights.set(TIPPED, new api.Highlight(...tipped.map(toRange)))
    if (chosen) api.highlights.set(CHOSEN, new api.Highlight(toRange(chosen)))
    else api.highlights.delete(CHOSEN)
    return () => {
      api.highlights.delete(CHOSEN)
      api.highlights.delete(TIPPED)
    }
  }
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return () => {}
  const marks = [
    ...tipped.flatMap((span) =>
      wrap(toRange(span), { 'data-heat': '3', 'data-read-paint': '' })
    ),
    ...(chosen
      ? wrap(toRange(chosen), {
          'data-heat': '1',
          'data-targeted': '',
          'data-read-paint': '',
        })
      : []),
  ]
  return () => unwrap(marks)
}
