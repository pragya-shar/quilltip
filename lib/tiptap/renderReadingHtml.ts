import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/core'
import {
  extractH2HeadingsFromTiptapJson,
  withHeadingIds,
  type TocHeading,
} from '@/lib/articles/toc'
import { markBodyImagesLazy } from '@/lib/tiptap/markBodyImagesLazy'
import { paragraphNumbers, readAnchor } from '@/lib/tiptap/readAnchors'
import { getReadOnlyExtensions } from '@/lib/tiptap/readExtensions'

export type ReadingHtml = {
  /** The article body as HTML, or undefined when it could not render. */
  html: string | undefined
  /** Level-2 headings, with the ids the HTML carries. */
  headings: TocHeading[]
}

/**
 * The article body for the reading view, rendered on the server: the same
 * HTML as `renderArticleHtml` (lazy images below the opening), with ids on
 * the level-2 headings and on every top-level paragraph (`s-{p}-0`, the
 * anchor scheme of `lib/tiptap/readAnchors.ts`), so links into the
 * article land with no script. Server components only: the reader never
 * downloads the editor libraries.
 */
export function renderReadingHtml(
  content: JSONContent | null | undefined
): ReadingHtml {
  const headings = extractH2HeadingsFromTiptapJson(content)
  if (!content) return { html: undefined, headings }
  try {
    const doc = markBodyImagesLazy(content)
    const extensions = getReadOnlyExtensions()
    const numbers = paragraphNumbers(doc)
    // Block by block, so each top-level paragraph gets its id; the
    // concatenation is the same HTML as rendering the whole document.
    const html = (doc.content ?? [])
      .map((block, index) => {
        const part = generateHTML({ ...doc, content: [block] }, extensions)
        const paragraph = numbers[index]
        return paragraph === null || paragraph === undefined
          ? part
          : part.replace(/^<p(?=[\s>])/, `<p id="${readAnchor(paragraph)}"`)
      })
      .join('')
    return { html: withHeadingIds(html, headings), headings }
  } catch (error) {
    console.error('Server article HTML render failed', error)
    return { html: undefined, headings }
  }
}
