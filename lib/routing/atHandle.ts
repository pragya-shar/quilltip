import { isReservedFirstSegment, publicContentPath } from './publicContentPath'

/**
 * `/@{handle}` (and `/@{handle}/{slug}`), as people write a writer's
 * address, answers a permanent redirect to `/{handle}` (`/{handle}/{slug}`),
 * keeping the query. The target must pass the same rule as the proxy's
 * route check (`publicContentPath`): a reserved segment (in any case, and
 * the route handlers' `api`), a dot or an encoded path gives no redirect, so
 * nothing but a same-site writer path can be the target. Returns null for
 * every other path.
 */
export function atHandleRedirect(url: URL): URL | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (!first || segments.length > 2) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(first)
  } catch {
    return null
  }
  if (!decoded.startsWith('@')) return null
  const handle = decoded.slice(1)
  if (!handle || handle.includes('/') || handle.includes('@')) return null
  if (isReservedFirstSegment(handle)) return null
  const rest = segments.slice(1)
  const pathname = `/${[encodeURIComponent(handle), ...rest].join('/')}`
  const target = publicContentPath(pathname)
  if (!target || target.username !== handle) return null
  const next = new URL(url.href)
  next.pathname = pathname
  return next
}
