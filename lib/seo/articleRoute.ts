/**
 * The proxy's route check for an article page, passed to the page in a request
 * header so the page does not ask the backend a second time. The proxy removes
 * any copy of this header that a client sends, so only its own answer arrives.
 *
 * - found: the article is published under this handle and slug; `version`
 *   names the stored copy (it changes on every write to the article, and a new
 *   article with the same slug has a different one).
 * - missing: no published article at this address.
 * - unknown: the check ran out of time or failed. The page then reads the
 *   article directly and never uses a cached copy, whose freshness is unknown.
 *
 * Requests the proxy does not check (client navigations) carry no header; the
 * page asks for itself.
 */
export const ARTICLE_ROUTE_HEADER = 'x-quilltip-article-route'

export type ArticleRoute =
  | { kind: 'found'; version?: string }
  | { kind: 'missing' }
  | { kind: 'unknown' }

export function formatArticleRoute(route: ArticleRoute): string {
  if (route.kind !== 'found') return route.kind
  // A backend without versions: the page reads the article directly.
  return route.version ? `found ${route.version}` : 'unknown'
}

export function parseArticleRoute(value: string | null): ArticleRoute | null {
  if (value === 'missing' || value === 'unknown') return { kind: value }
  if (value?.startsWith('found ') && value.length > 'found '.length)
    return { kind: 'found', version: value.slice('found '.length) }
  return null
}
