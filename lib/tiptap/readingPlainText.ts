import type { JSONContent } from '@tiptap/core'
import { sanitizeReadingDoc } from '@/lib/tiptap/sanitizeReadingDoc'

/**
 * The opening words of an article as plain text, for a description, read
 * within the reading limits: an oversized document gives none rather than
 * a deep walk.
 */
export function readingPlainText(
  content: JSONContent | null | undefined,
  max = 400
): string {
  if (!content) return ''
  let doc: JSONContent
  try {
    // Text only: no image source is read.
    doc = sanitizeReadingDoc(content, { storageOrigin: null })
  } catch {
    return ''
  }
  let out = ''
  const walk = (node: JSONContent) => {
    if (out.length >= max) return
    if (node.type === 'text' && node.text) out += node.text
    for (const child of node.content ?? []) {
      walk(child)
      if (out.length >= max) return
    }
    if (node.type === 'paragraph' || node.type === 'heading') out += ' '
  }
  walk(doc)
  return out.replace(/\s+/g, ' ').trim().slice(0, max)
}
