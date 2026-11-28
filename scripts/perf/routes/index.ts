/**
 * The rebuilt routes under the performance checks. Each package owns one
 * file here and edits only that file; first-load.ts, page-load-budget.ts and
 * font-fallback-check.ts read the merged lists below. A legacy entry drops
 * out when its page is listed as deleted (scripts/rebuild/deleted) or a
 * package's entry names the same route or path: no package edits legacy.ts
 * or the scripts. A foundation entry for a page a package owns (the
 * placeholder `/shelf`) drops out the same way when that package's file
 * names the route or path.
 */
import { deletedPaths } from '../../rebuild/deleted-paths'
import {
  LEGACY_FIRST_LOAD,
  LEGACY_FONT_FALLBACK,
  LEGACY_PAGE_LOAD,
} from './legacy'
import type { PerfRoutes } from './types'
import { routes as foundation } from './foundation'
import { routes as ops } from './ops'
import { routes as pocket } from './pocket'
import { routes as read } from './read'
import { routes as resources } from './resources'
import { routes as search } from './search'
import { routes as shelf } from './shelf'
import { routes as signin } from './signin'
import { routes as today } from './today'
import { routes as write } from './write'
import { routes as writer } from './writer'
import { routes as you } from './you'

export type {
  PageLoadBudget,
  PageLoadRoute,
  PerfRoutes,
  WayHome,
} from './types'

export const PERF_ROUTE_PACKAGES = {
  foundation,
  ops,
  pocket,
  read,
  resources,
  search,
  shelf,
  signin,
  today,
  write,
  writer,
  you,
} satisfies Record<string, PerfRoutes>

const all = Object.values(PERF_ROUTE_PACKAGES) as PerfRoutes[]

/**
 * The packages' entries merged: the foundation's first, less any route or
 * path another package names (that package's entry replaces it). Pure.
 */
export function mergePackageRoutes(packages: Record<string, PerfRoutes>) {
  const { foundation: base = {}, ...rest } = packages
  const others = Object.values(rest)
  const firstLoad = others.flatMap((p) => p.firstLoad ?? [])
  const pageLoad = others.flatMap((p) => p.pageLoad ?? [])
  const fontFallback = others.flatMap((p) => p.fontFallback ?? [])
  return {
    firstLoad: [
      ...(base.firstLoad ?? []).filter(
        (entry) => !firstLoad.some((own) => own.route === entry.route)
      ),
      ...firstLoad,
    ],
    pageLoad: [
      ...(base.pageLoad ?? []).filter(
        (entry) => !pageLoad.some((own) => own.path === entry.path)
      ),
      ...pageLoad,
    ],
    fontFallback: [
      ...(base.fontFallback ?? []).filter(
        (entry) => !fontFallback.some((own) => own.path === entry.path)
      ),
      ...fontFallback,
    ],
  }
}

const merged = mergePackageRoutes(PERF_ROUTE_PACKAGES)
export const SURFACE_FIRST_LOAD = merged.firstLoad
export const SURFACE_PAGE_LOAD = merged.pageLoad
export const SURFACE_FONT_FALLBACK = merged.fontFallback
export const SURFACE_WAY_HOME = all.flatMap((p) => p.wayHome ?? [])

const deleted = deletedPaths().map((entry) => entry.path.replace(/\/$/, ''))

/** Whether a legacy page is listed as deleted: the file, or a directory
 * above it. */
export function legacyPageDeleted(
  page: string,
  listed: readonly string[] = deleted
): boolean {
  return listed.some((entry) => page === entry || page.startsWith(`${entry}/`))
}

/** Every first-load route with its budget: legacy ones not replaced, then
 * the packages'. */
export const FIRST_LOAD_ENTRIES: readonly {
  route: string
  budgetKb: number
}[] = [
  ...LEGACY_FIRST_LOAD.filter(
    (entry) =>
      !legacyPageDeleted(entry.page) &&
      !SURFACE_FIRST_LOAD.some((own) => own.route === entry.route)
  ),
  ...SURFACE_FIRST_LOAD,
]

/** Every page-load route, the same way, by path. */
export const PAGE_LOAD_ROUTES = [
  ...LEGACY_PAGE_LOAD.filter(
    (entry) =>
      !legacyPageDeleted(entry.page) &&
      !SURFACE_PAGE_LOAD.some((own) => own.path === entry.path)
  ),
  ...SURFACE_PAGE_LOAD,
]

/** Every font fallback route, the same way, by path. */
export const FONT_FALLBACK_ROUTES = [
  ...LEGACY_FONT_FALLBACK.filter(
    (entry) =>
      !legacyPageDeleted(entry.page) &&
      !SURFACE_FONT_FALLBACK.some((own) => own.path === entry.path)
  ),
  ...SURFACE_FONT_FALLBACK,
]

/** Public routes whose no-script first response a production-build check
 * covers, and public routes left unmeasured, with why. */
export const NO_SCRIPT_ROUTES = new Set(all.flatMap((p) => p.noScript ?? []))
export const UNMEASURED = all.flatMap((p) => p.unmeasured ?? [])

/** Protected old pages that send a signed-out reader to a package's page,
 * which offers sign-in itself. */
export const SIGNED_OUT_LANDING = all.flatMap((p) => p.signedOutLanding ?? [])
