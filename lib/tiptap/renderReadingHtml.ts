import type { JSONContent } from '@tiptap/core'
import {
  extractH2HeadingsFromTiptapJson,
  withHeadingIds,
  type TocHeading,
} from '@/lib/articles/toc'
import { withParagraphAnchors } from '@/lib/tiptap/readAnchors'
import { renderArticleHtml } from '@/lib/tiptap/renderArticleHtml'

export type ReadingHtml = {
  /** The article body as HTML, or undefined when it could not render. */
  html: string | undefined
  /** Level-2 headings, with the ids the HTML carries. */
  headings: TocHeading[]
}

/**
 * The article body for the reading view, rendered on the server: the same
 * HTML as `renderArticleHtml` (lazy images below the opening), with ids on
 * the level-2 headings and on every body paragraph (`s-{p}-0`, the anchor
 * scheme of `lib/tiptap/readAnchors.ts`), so links into the article land
 * with no script. Server components only: the reader never downloads the
 * editor libraries.
 */
export function renderReadingHtml(
  content: JSONContent | null | undefined
): ReadingHtml {
  const headings = extractH2HeadingsFromTiptapJson(content)
  const html = content
    ? renderArticleHtml(withParagraphAnchors(content))
    : undefined
  return { html: html && withHeadingIds(html, headings), headings }
}
