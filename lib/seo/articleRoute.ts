/**
 * The proxy's route check for an article page, passed to the page in a request
 * header so the page does not ask the backend a second time. The proxy removes
 * any copy of this header that a client sends, so only its own answer arrives.
 *
 * - found: the article is published under this handle and slug; `version`
 *   names the stored copy (it changes on every write to the article, and a new
 *   article with the same slug has a different one).
 * - missing: no published article at this address.
 */
export const ARTICLE_ROUTE_HEADER = 'x-quilltip-article-route'

export type ArticleRoute =
  | { kind: 'found'; version?: string }
  | { kind: 'missing' }

export function formatArticleRoute(route: ArticleRoute): string | null {
  if (route.kind === 'missing') return 'missing'
  // Without a version the page checks for itself.
  return route.version ? `found ${route.version}` : null
}

export function parseArticleRoute(value: string | null): ArticleRoute | null {
  if (value === 'missing') return { kind: 'missing' }
  if (value?.startsWith('found ') && value.length > 'found '.length)
    return { kind: 'found', version: value.slice('found '.length) }
  return null
}
