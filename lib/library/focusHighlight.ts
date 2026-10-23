import type { Editor } from '@tiptap/react'
import {
  HighlightConverter,
  type HighlightData,
} from '@/lib/highlights/HighlightConverter'
/** Focus the saved passage after the existing editor has rendered its highlights. */
export function focusLibraryHighlight(
  root: HTMLElement,
  id: string,
  reducedMotion = false,
  context?: { editor: Editor; highlights: HighlightData[] }
): boolean {
  let element = [
    ...root.querySelectorAll<HTMLElement>('[data-highlight-id]'),
  ].find((node) => node.dataset.highlightId === id)
  if (!element && context) {
    const highlight = context.highlights.find((h) => h._id === id)
    if (highlight) {
      const position = HighlightConverter.getDocumentPosition(
        context.editor.state.doc,
        highlight.startOffset
      )
      if (position >= 0 && position <= context.editor.state.doc.content.size) {
        const point = context.editor.view.domAtPos(position)
        const node =
          point.node.nodeType === Node.ELEMENT_NODE
            ? (point.node.childNodes[point.offset] ?? point.node)
            : point.node
        const parent =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : node.parentElement
        const mark = parent?.closest<HTMLElement>('[data-highlight-id]')
        if (mark && root.contains(mark)) element = mark
      }
    }
  }
  if (!element) return false
  element.tabIndex = -1
  element.scrollIntoView({
    block: 'center',
    behavior: reducedMotion ? 'instant' : 'smooth',
  })
  element.focus({ preventScroll: true })
  return true
}
