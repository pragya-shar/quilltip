import { FIXTURE_ARTICLE_PATH } from '../convex-fixture'
import type { PageLoadRoute } from './types'

/**
 * The legacy routes under the performance checks, until the surface that
 * replaces each one lands. Nobody edits this file to replace one: an entry
 * drops out when its `page` is listed in scripts/rebuild/deleted/<package>.txt
 * (the file or a directory above it), or when a package's own entry names the
 * same route (first load) or path (page load, font fallback).
 *
 * Budgets sit a little above the measured size (in the comment); see
 * scripts/perf/first-load.ts and scripts/perf/page-load-budget.ts.
 */
/** The page file that serves a legacy entry. */
type Served = { page: string }

export const LEGACY_FIRST_LOAD: readonly ({
  route: string
  budgetKb: number
} & Served)[] = [
  { route: '/', page: 'app/(legacy)/page.tsx', budgetKb: 211 }, // measured 208.9
  {
    route: '/login',
    page: 'app/(legacy)/(auth)/login/page.tsx',
    budgetKb: 202,
  }, // measured 199.4
  { route: '/articles', page: 'app/(legacy)/articles/page.tsx', budgetKb: 216 }, // measured 214.0
  {
    route: '/[username]/[slug]',
    page: 'app/(legacy)/[username]/[slug]/page.tsx',
    budgetKb: 219,
  }, // measured 216.9
]

export const LEGACY_PAGE_LOAD: readonly (PageLoadRoute & Served)[] = [
  {
    name: 'landing',
    path: '/',
    page: 'app/(legacy)/page.tsx',
    // Measured: HTML 38 KB, stylesheets 39 KB, fonts 169 KB (ten faces).
    budget: { htmlKb: 42, cssKb: 41, fontKb: 172 },
  },
  {
    name: 'login',
    path: '/login',
    page: 'app/(legacy)/(auth)/login/page.tsx',
    // Measured: HTML 30 KB, stylesheets 29 KB, fonts 39 KB.
    budget: { htmlKb: 34, cssKb: 31, fontKb: 42 },
  },
  {
    name: 'articles',
    path: '/articles',
    page: 'app/(legacy)/articles/page.tsx',
    // Measured: HTML 44 KB, stylesheets 29 KB, fonts 79 KB.
    budget: { htmlKb: 48, cssKb: 31, fontKb: 82 },
  },
  {
    name: 'article',
    path: FIXTURE_ARTICLE_PATH,
    page: 'app/(legacy)/[username]/[slug]/page.tsx',
    // Measured: HTML 40 KB, stylesheets 26 KB, fonts 98 KB.
    budget: { htmlKb: 44, cssKb: 28, fontKb: 101 },
  },
]

/** The four measured routes, and /guide, which uses Landing Syne at 500 and
 * Wallet Syne (the 600 file at every weight). */
export const LEGACY_FONT_FALLBACK: readonly ({
  name: string
  path: string
  gateMovement: boolean
} & Served)[] = [
  {
    name: 'landing',
    path: '/',
    page: 'app/(legacy)/page.tsx',
    gateMovement: true,
  },
  {
    name: 'login',
    path: '/login',
    page: 'app/(legacy)/(auth)/login/page.tsx',
    gateMovement: true,
  },
  {
    name: 'articles',
    path: '/articles',
    page: 'app/(legacy)/articles/page.tsx',
    gateMovement: true,
  },
  {
    name: 'article',
    path: FIXTURE_ARTICLE_PATH,
    page: 'app/(legacy)/[username]/[slug]/page.tsx',
    gateMovement: true,
  },
  {
    name: 'guide',
    path: '/guide',
    page: 'app/(legacy)/guide/page.tsx',
    gateMovement: true,
  },
]
