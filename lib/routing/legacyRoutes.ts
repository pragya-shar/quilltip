/**
 * Which paths the legacy pages (app/(legacy)) still serve, so a link from
 * the new shell to one of them never prefetches: crossing root layouts is
 * a full page load, and a prefetch would only pull the legacy layout's
 * fonts and scripts onto the new page. next.config.ts reads the route tree
 * at build (`legacyRouteTree`) and passes it as NEXT_PUBLIC_LEGACY_ROUTES;
 * `prefetchFor` reads that. With no value (fixtures, tests), nothing is
 * legacy.
 */

import { APP_ROUTE_SEGMENTS, publicContentPath } from './publicContentPath'

export type LegacyRouteTree = {
  /** app/(legacy)/page.tsx serves `/`. */
  home: boolean
  /** Top-level segments with pages under app/(legacy). */
  segments: string[]
  /** app/(legacy)/[username] serves writer pages. */
  writer: boolean
}

const EMPTY: LegacyRouteTree = { home: false, segments: [], writer: false }

/** Whether a path is served by a legacy page. Pure. */
export function servedByLegacy(href: string, tree: LegacyRouteTree): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false
  const pathname = href.split(/[?#]/)[0] ?? '/'
  const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (!first) return tree.home
  if (tree.segments.some((segment) => segment.toLowerCase() === first))
    return true
  // Anything else at the top level is a writer's page, or the shell's: a
  // segment the registry reserves (lib/routing/segments) is never a writer.
  return tree.writer && !first.includes('.') && !APP_ROUTE_SEGMENTS.has(first)
}

/**
 * The shell's own first segments for a tree: every reserved segment the
 * tree does not serve. Derived, so a package that adds a route reserves
 * its segment in its own file and nothing here changes.
 */
export function shellSegments(tree: LegacyRouteTree): ReadonlySet<string> {
  const legacy = new Set(tree.segments.map((segment) => segment.toLowerCase()))
  return new Set([...APP_ROUTE_SEGMENTS].filter((s) => !legacy.has(s)))
}

function treeFromEnv(): LegacyRouteTree {
  const raw = process.env.NEXT_PUBLIC_LEGACY_ROUTES
  if (!raw) return EMPTY
  try {
    const value = JSON.parse(raw) as Partial<LegacyRouteTree>
    return {
      home: value.home === true,
      segments: Array.isArray(value.segments) ? value.segments : [],
      writer: value.writer === true,
    }
  } catch {
    return EMPTY
  }
}

const TREE = treeFromEnv()

/**
 * How a link from the shell prefetches its target (system/components/AppLink):
 * - `never`: a legacy page. Crossing root layouts is a full page load, and a
 *   prefetch would only pull the legacy layout's fonts and scripts here.
 * - `intent`: a page behind the proxy's route check (a writer's page or an
 *   article). A prefetch runs that check like a full load, so a list of
 *   them in view would cost one backend check each: prefetch only when the
 *   reader points at, touches or focuses the link.
 * - `default`: the shell's own places (Today, Shelf, Write, the balance),
 *   prefetched as Next.js does.
 */
export type PrefetchPolicy = 'never' | 'intent' | 'default'

export function linkPrefetch(
  href: string,
  tree: LegacyRouteTree = TREE
): PrefetchPolicy {
  if (servedByLegacy(href, tree)) return 'never'
  if (!href.startsWith('/') || href.startsWith('//')) return 'default'
  const pathname = href.split(/[?#]/)[0] ?? '/'
  return publicContentPath(pathname) ? 'intent' : 'default'
}

/**
 * The `prefetch` value for a link from the shell: false when a legacy page
 * serves `href` or the route check stands in front of it, otherwise
 * undefined (Next.js's default). AppLink adds the prefetch on intent.
 */
export function prefetchFor(href: string, tree: LegacyRouteTree = TREE) {
  return linkPrefetch(href, tree) === 'default' ? undefined : false
}
