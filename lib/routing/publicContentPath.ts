import { RESERVED_SEGMENTS } from './segments'

/**
 * First path segments that belong to app routes, not to writers. Writer pages
 * live at /<username> and /<username>/<slug>. One file per package in
 * lib/routing/segments; scripts/system/reserved-segments.test.ts fails when a
 * route under app/(app) or app/(legacy) is not reserved.
 */
export const APP_ROUTE_SEGMENTS: ReadonlySet<string> = new Set(
  RESERVED_SEGMENTS
)

/** Framework paths; usernames may otherwise start with an underscore. */
const NEXT_INTERNAL_SEGMENTS = new Set(['_next', '_vercel'])

/** Route handlers under app/api, outside the proxy's matcher. */
const ROUTE_HANDLER_SEGMENTS = new Set(['api'])

/**
 * Whether a name, in any case, is a first segment that is never a writer's
 * page: a reserved segment, a framework path or the route handlers. For
 * redirects that build a writer path from what a person typed.
 */
export function isReservedFirstSegment(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    APP_ROUTE_SEGMENTS.has(lower) ||
    NEXT_INTERNAL_SEGMENTS.has(lower) ||
    ROUTE_HANDLER_SEGMENTS.has(lower)
  )
}

/**
 * Returns the writer (and article slug) a path points at, or null for app
 * routes, files and anything deeper than two segments.
 */
export function publicContentPath(
  pathname: string
): { username: string; slug?: string } | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 1 || segments.length > 2) return null

  let decoded: string[]
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  const [username, slug] = decoded
  if (
    !username ||
    APP_ROUTE_SEGMENTS.has(username) ||
    NEXT_INTERNAL_SEGMENTS.has(username) ||
    // Files such as robots.txt, sitemap.xml and public/ assets. Article slugs
    // never contain a dot, so this cannot hide an article.
    decoded.some((segment) => segment.includes('.'))
  ) {
    return null
  }
  return slug === undefined ? { username } : { username, slug }
}

/** The username a not-found URL was meant to show, if it is a writer page. */
export function writerPathUsername(pathname: string): string | null {
  const target = publicContentPath(pathname)
  return target && target.slug === undefined ? target.username : null
}
