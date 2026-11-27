import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/core'
import type { TocHeading } from '@/lib/articles/toc'
import { markBodyImagesLazy } from '@/lib/tiptap/markBodyImagesLazy'
import { withReadingAnchors } from '@/lib/tiptap/readAnchors'
import { getReadingExtensions } from '@/lib/tiptap/readingExtensions'
import {
  DocumentTooLarge,
  sanitizeReadingDoc,
} from '@/lib/tiptap/sanitizeReadingDoc'

export type ReadingHtml = {
  /** The article body as HTML, or undefined when it could not render. */
  html: string | undefined
  /** Level-2 headings, with the ids the HTML carries. */
  headings: TocHeading[]
  /** Past the reading limits: not rendered; show the not-available state. */
  tooLarge?: boolean
}

/**
 * The article body for the reading view, rendered on the server from the
 * author's document after reducing it to the nodes, marks and attributes
 * the reading page allows (`sanitizeReadingDoc`). Body paragraphs carry
 * `s-{p}-0` and level-2 headings `h-…` (`readAnchors.ts`), set in the
 * document before rendering, so links into the article land with no script.
 * Nothing edits the rendered HTML. Server components only: the reader never
 * downloads the editor libraries.
 */
export function renderReadingHtml(
  content: JSONContent | null | undefined
): ReadingHtml {
  if (!content) return { html: undefined, headings: [] }
  try {
    const { doc, headings } = withReadingAnchors(sanitizeReadingDoc(content))
    const html = generateHTML(markBodyImagesLazy(doc), getReadingExtensions())
    return { html, headings }
  } catch (error) {
    if (error instanceof DocumentTooLarge)
      return { html: undefined, headings: [], tooLarge: true }
    console.error('Server article HTML render failed', error)
    return { html: undefined, headings: [] }
  }
}
