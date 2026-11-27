/**
 * The rebuilt routes under the performance checks. Each package owns one
 * file here and edits only that file; first-load.ts, page-load-budget.ts and
 * font-fallback-check.ts add these entries to their lists. A package that
 * replaces a legacy route removes that route's entry from the legacy list.
 */
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

export type { PerfRoutes } from './types'

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

export const SURFACE_FIRST_LOAD = all.flatMap((p) => p.firstLoad ?? [])
export const SURFACE_PAGE_LOAD = all.flatMap((p) => p.pageLoad ?? [])
export const SURFACE_FONT_FALLBACK = all.flatMap((p) => p.fontFallback ?? [])
