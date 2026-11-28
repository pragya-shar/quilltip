/**
 * Which paths the legacy pages (app/(legacy)) still serve, so a link from
 * the new shell to one of them never prefetches: crossing root layouts is
 * a full page load, and a prefetch would only pull the legacy layout's
 * fonts and scripts onto the new page. next.config.ts reads the route tree
 * at build (`legacyRouteTree`) and passes it as NEXT_PUBLIC_LEGACY_ROUTES;
 * `prefetchFor` reads that. With no value (fixtures, tests), nothing is
 * legacy.
 */

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
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first) return tree.home
  if (tree.segments.includes(first)) return true
  // Anything else at the top level is a writer's page, or the shell's.
  return tree.writer && !first.includes('.') && !SHELL_SEGMENTS.has(first)
}

/**
 * The shell's own first segments: never a writer, never legacy. Kept here
 * so this module stays free of the segment registry's imports; checked
 * against it by scripts/system/legacy-routes.test.ts.
 */
export const SHELL_SEGMENTS = new Set([
  'lines',
  'pocket',
  'search',
  'shelf',
  'signin',
  'system',
  'today',
  'you',
])

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
 * The `prefetch` value for a link from the shell: false when a legacy page
 * serves `href`, otherwise undefined (Next.js's default). Every next/link in
 * system/ and shell/ passes it (scripts/system/legacy-routes.test.ts).
 */
export function prefetchFor(href: string, tree: LegacyRouteTree = TREE) {
  return servedByLegacy(href, tree) ? false : undefined
}
