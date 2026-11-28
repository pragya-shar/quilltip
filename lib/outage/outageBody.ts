import { publicContentPath } from '@/lib/routing/publicContentPath'
import { legacyOutageBody } from '@/lib/outage/legacyOutageBody'
import type { OutageBody, OutagePathKind } from '@/lib/outage/outageHtml'

export type { OutageBody, OutagePathKind } from '@/lib/outage/outageHtml'

/**
 * The outage response for public reading (#609). When the backend cannot be
 * reached, the proxy answers 503 with `Retry-After: 30` and `no-store`, and
 * the body comes from the module of the path's root layout. A body module is
 * pure and synchronous, and imports nothing the proxy's runtime cannot
 * bundle: no React, no Node-only module, no app CSS file.
 */

/** Seconds a crawler should wait before asking again. */
export const OUTAGE_RETRY_AFTER_SECONDS = 30

/**
 * The path kind of a public reading path, or null. `/` is not one: its page
 * makes no server read, so it keeps 200 with its own content.
 */
export function outagePathKind(pathname: string): OutagePathKind | null {
  if (pathname === '/articles') return 'articles'
  const target = publicContentPath(pathname)
  if (!target) return null
  return target.slug === undefined ? 'writer' : 'article'
}

/**
 * The seam between a path and its root layout's outage body. Null means no
 * outage response: the request goes on to the page, which shows its own
 * readable fallback (200, `noindex`). On v2 there is one root layout, so
 * every public reading path gets the legacy body; a later layout replaces
 * this mapping with its own route list.
 */
export function outageBodyFor(
  pathname: string
): { kind: OutagePathKind; body: OutageBody } | null {
  const kind = outagePathKind(pathname)
  return kind ? { kind, body: legacyOutageBody } : null
}

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
