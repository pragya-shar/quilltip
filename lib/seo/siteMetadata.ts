import { extractPlainTextFromTiptapJson } from '@/lib/tiptap/plainText'

export const SITE_NAME = 'Quilltip'
export const SITE_ORIGIN = 'https://www.quilltip.me'

const DESCRIPTION_MAX = 160

/** Collapses whitespace and trims to a search-friendly description length. */
export function toMetaDescription(text: string | null | undefined) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= DESCRIPTION_MAX) return clean
  const cut = clean.slice(0, DESCRIPTION_MAX - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Prefers the writer's excerpt; falls back to the opening of the article text. */
export function articleMetaDescription(article: {
  excerpt?: string | null
  content?: unknown
}) {
  return toMetaDescription(
    article.excerpt?.trim() || extractPlainTextFromTiptapJson(article.content)
  )
}

export function articlePath(username: string, slug: string) {
  return `/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`
}

export function profilePath(username: string) {
  return `/${encodeURIComponent(username)}`
}
