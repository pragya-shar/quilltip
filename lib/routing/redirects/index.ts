import { TODAY_REDIRECTS } from './today'
import type { Redirect } from './types'

/**
 * Every old path that moved in the rebuild, one table per package
 * (rebuild plan 5.4). proxy.ts answers them with 308 before anything else.
 * A package adds `<package>.ts` beside this file and one entry here; the
 * final removal deletes the directory.
 */
export const REDIRECTS: readonly Redirect[] = [...TODAY_REDIRECTS]

const byPath = new Map(REDIRECTS.map((redirect) => [redirect.from, redirect]))

/** The first path segment of every redirect source: these stay reserved. */
export const REDIRECTED_SEGMENTS: ReadonlySet<string> = new Set(
  REDIRECTS.map((redirect) => redirect.from.split('/')[1]!)
)

/** The new location for an old path, or null when the path did not move. */
export function redirectFor(url: URL): URL | null {
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  const redirect = byPath.get(path)
  if (!redirect) return null
  return new URL(redirect.to(url), url)
}
