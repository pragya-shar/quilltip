import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/core'
import { getReadOnlyExtensions } from '@/lib/tiptap/readExtensions'
import { markBodyImagesLazy } from '@/lib/tiptap/markBodyImagesLazy'

/**
 * Renders a published article body to HTML on the server. Import it from
 * server components only: the page then ships the finished HTML, and readers
 * do not download the editor libraries before the article appears. Images
 * below the opening blocks load lazily (`markBodyImagesLazy`).
 */
export function renderArticleHtml(content: JSONContent | null | undefined) {
  if (!content) return undefined
  try {
    return generateHTML(markBodyImagesLazy(content), getReadOnlyExtensions())
  } catch (error) {
    // The client renders the body itself when this is missing.
    console.error('Server article HTML render failed', error)
    return undefined
  }
}
