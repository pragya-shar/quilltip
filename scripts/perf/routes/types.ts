/**
 * The routes a package puts under the performance checks.
 *
 * First-load JavaScript (gzip): a route's budget is its first CI measurement
 * plus 2 KB, at most 195 KB for now, public and signed-in alike
 * (`FIRST_LOAD_CEILING_KB`; the shell alone measured 181 KB, above the
 * earlier signed-in 170); the public target stays 150 KB, which
 * the shell reaches once the backend client leaves the first load of public
 * pages. Public pages hold layout still (CLS 0.05) and paint their main
 * content within 2 s on a mid-range phone.
 */

import type { Page } from '@playwright/test'

/** The most a package's first-load budget may be, by access. */
export const FIRST_LOAD_CEILING_KB = { public: 195, 'signed-in': 195 } as const

/** Where public routes are headed. */
export const FIRST_LOAD_TARGET_KB = 150
/** One route of the page-load check. Sizes are compressed KB. */
export type PageLoadBudget = {
  htmlKb: number
  cssKb: number
  fontKb: number
  /** Gated CLS for this route (both profiles). Public routes: 0.05.
   * Without it the check's general limit (0.1) applies. */
  cls?: number
  /** Gated median LCP on the phone profile (Moto G Power, 412 x 823,
   * throttled), in ms. Public routes: 2000. Without it LCP is
   * reported, not gated. The desktop profile is never gated. */
  lcpMobileMs?: number
  /**
   * `false` only on a signed-in route whose largest paint is drawn from the
   * browser's session (the session lives in the browser, so the server HTML
   * cannot hold who is here or their figures). The check then reports, and
   * does not gate, "LCP element is not in the server HTML"; every other
   * budget stays gated, and the server HTML must still hold the page's
   * heading and reserve the space, so nothing moves when the session
   * resolves (CLS stays gated). Public routes keep the rule.
   */
  lcpInServerHtml?: false
}

export type PageLoadRoute = {
  name: string
  path: string
  budget: PageLoadBudget
}

type Role = Parameters<Page['getByRole']>[0]
/** A locator by role and accessible name, inside an optional landmark. */
export type WayHome = { within?: Role; role: Role; name: string }

export type PerfRoutes = {
  /** First-load JavaScript (scripts/perf/first-load.ts). `route` is the
   * route as Next.js names it: '/[username]/[slug]', '/shelf'. */
  firstLoad?: readonly {
    route: string
    budgetKb: number
    /** The first CI measurement plus 2 KB, at most
     * `FIRST_LOAD_CEILING_KB[access]`. */
    access: 'public' | 'signed-in'
  }[]
  /** Page-load budget (scripts/perf/page-load-budget.ts). `path` is a real
   * URL on the fixture backend. */
  pageLoad?: readonly PageLoadRoute[]
  /** Public routes (Next.js names) whose first response with no script a
   * production-build check of this package covers (scripts/app-checks). */
  noScript?: readonly string[]
  /** Public routes with no first-load budget or no no-script check, each
   * with the reason. Every other public route needs both. */
  unmeasured?: readonly { route: string; reason: string }[]
  /** Font fallback check (scripts/perf/font-fallback-check.ts). */
  fontFallback?: readonly {
    name: string
    path: string
    gateMovement: boolean
  }[]
  /** How a reader finds the way home on this package's public pages at
   * 375 px with no script, by `path` (a real URL on the fixture backend),
   * when the page cannot read the backend (scripts/perf/slow-backend-reading.ts).
   * A path not listed here keeps the legacy header's (READING.wayHome). */
  wayHome?: readonly { path: string; wayHome: WayHome }[]
  /**
   * Protected old pages that now send a signed-out reader to a page of this
   * package instead of the sign-in page (scripts/perf/no-script-reading.ts),
   * by `path`. With scripts on and off, the visit ends at `endsAt`, whose
   * `main` holds a link named `signInLink` to the sign-in page that comes
   * back to `endsAt`, and no money; with no script, following it shows the
   * sign-in form. A protected page not listed here must end at sign-in.
   */
  signedOutLanding?: readonly {
    path: string
    endsAt: string
    signInLink: string
  }[]
}
