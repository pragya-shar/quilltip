/**
 * Types and helpers for outage body modules (#609), with no imports, so a
 * body module for any root layout can use them without a cycle.
 */

/** The public reading pages whose content is the backend's answer. */
export type OutagePathKind = 'articles' | 'writer' | 'article'

/** Renders the whole outage document for one path. */
export type OutageBody = (
  kind: OutagePathKind,
  url: URL,
  nonce: string
) => string

/**
 * The "Try again" link: the request's own path and query, always a path on
 * this site. Leading slashes and backslashes collapse to one slash, so a
 * path such as `//evil.example` cannot become a link to another host.
 */
export function sameSiteRetryHref(url: URL): string {
  const path = `/${url.pathname.replace(/^[/\\]+/, '')}`
  return `${path}${url.search}`
}

/** Escapes text for HTML text and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Seconds a crawler should wait before asking again. */
export const OUTAGE_RETRY_AFTER_SECONDS = 30

/**
 * The outage document's own policy: nothing loads but its inline style,
 * which carries the request's nonce. No scripts, no `unsafe-inline`.
 */
export function outageContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
