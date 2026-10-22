import { extractTextFromTiptapJson } from './tiptapContent'

/** A display-only preview; never persisted as the author's optional subtitle. */
export function getArticlePreview(article: {
  excerpt?: string | null
  content?: unknown
}): string {
  const subtitle = article.excerpt?.trim()
  if (subtitle) return subtitle
  const opening = extractTextFromTiptapJson(article.content)
    .replace(/\s+/g, ' ')
    .trim()
  if (opening.length <= 240) return opening
  const prefix = opening.slice(0, 239)
  const boundary = prefix.lastIndexOf(' ')
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`
}
