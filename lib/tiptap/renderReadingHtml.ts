import type { JSONContent } from '@tiptap/core'
import {
  extractH2HeadingsFromTiptapJson,
  withHeadingIds,
  type TocHeading,
} from '@/lib/articles/toc'
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
 * the level-2 headings. Server components only: the reader never downloads
 * the editor libraries.
 */
export function renderReadingHtml(
  content: JSONContent | null | undefined
): ReadingHtml {
  const headings = extractH2HeadingsFromTiptapJson(content)
  const html = renderArticleHtml(content)
  return { html: html && withHeadingIds(html, headings), headings }
}
