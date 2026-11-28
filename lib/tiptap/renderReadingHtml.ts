import { getSchema, type JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/html'
import { Node, type Schema } from '@tiptap/pm/model'
import type { TocHeading } from '@/lib/articles/toc'
import { withReadingAnchors } from '@/lib/tiptap/readAnchors'
import { getReadingExtensions } from '@/lib/tiptap/readingExtensions'
import {
  deploymentSources,
  DocumentTooLarge,
  sanitizeReadingDoc,
  type ReadingSources,
} from '@/lib/tiptap/sanitizeReadingDoc'

export type ReadingHtml =
  | {
      /** The article body as HTML. */
      html: string
      /** Level-2 headings, with the ids the HTML carries. */
      headings: TocHeading[]
    }
  | {
      html: undefined
      headings: []
      /** Why it did not render; the page shows its not-available state. */
      unavailable: 'too-large' | 'invalid'
    }

/** Whether the document holds text, an image or an embed. */
function hasReadableContent(node: JSONContent): boolean {
  if (node.type === 'text') return /\S/.test(node.text ?? '')
  if (node.type === 'resizableImage' || node.type === 'youtube') return true
  return node.content?.some(hasReadableContent) ?? false
}

let schema: Schema | undefined
const readingSchema = () => (schema ??= getSchema(getReadingExtensions()))

/**
 * The article body for the reading view, rendered on the server from the
 * author's document after reducing it to the nodes, marks and attributes
 * the reading page allows (`sanitizeReadingDoc`). Body paragraphs carry
 * `s-{p}-0` and level-2 headings `h-…` (`readAnchors.ts`), set in the
 * document before rendering, so links into the article land with no script.
 * The result is checked against the reading schema before it renders. Any
 * failure, a document past the limits, one with nothing left to show or
 * one the schema refuses, returns no HTML: the page shows its not-available
 * state, never an empty article. Nothing edits the rendered HTML. Server
 * components only: the reader never downloads the editor libraries.
 */
export function renderReadingHtml(
  content: JSONContent | null | undefined,
  sources: ReadingSources = deploymentSources()
): ReadingHtml {
  try {
    const clean = sanitizeReadingDoc(content ?? { type: 'doc' }, sources)
    // Nothing a reader can read or see (no text, image or embed): the
    // not-available state, never an empty article.
    if (!hasReadableContent(clean))
      return { html: undefined, headings: [], unavailable: 'invalid' }
    const { doc, headings } = withReadingAnchors(clean)
    Node.fromJSON(readingSchema(), doc).check()
    return { html: generateHTML(doc, getReadingExtensions()), headings }
  } catch (error) {
    if (error instanceof DocumentTooLarge)
      return { html: undefined, headings: [], unavailable: 'too-large' }
    console.error('Server article HTML render failed', error)
    return { html: undefined, headings: [], unavailable: 'invalid' }
  }
}
