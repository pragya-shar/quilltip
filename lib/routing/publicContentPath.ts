/**
 * First path segments that belong to app routes, not to writers. Writer pages
 * live at /<username> and /<username>/<slug>. Kept in sync with app/ by
 * scripts/articles/public-content-path.test.ts.
 */
export const APP_ROUTE_SEGMENTS = new Set([
  'articles',
  'contact',
  'dashboard',
  'demo',
  'drafts',
  'forgot-password',
  'guide',
  'library',
  'login',
  'privacy',
  'profile',
  'register',
  'reset-password',
  'settings',
  'status',
  'support',
  'terms',
  'waitlist',
  'wallet',
  'welcome',
  'write',
])

/** Framework paths; usernames may otherwise start with an underscore. */
const NEXT_INTERNAL_SEGMENTS = new Set(['_next', '_vercel'])

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
