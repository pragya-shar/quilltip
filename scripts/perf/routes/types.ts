/**
 * The routes a package puts under the performance checks. Budgets follow
 * the plan's public-route limits: public routes at most 150 KB gzip of first-load
 * JavaScript, signed-in routes at most 170 KB.
 */
/** One route of the page-load check. Sizes are compressed KB. */
export type PageLoadBudget = {
  htmlKb: number
  cssKb: number
  fontKb: number
  /** Gated CLS for this route (both profiles). Public routes: 0.05 (plan
   * 4.1). Without it the check's general limit (0.1) applies. */
  cls?: number
  /** Gated median LCP on the phone profile (Moto G Power, 412 x 823,
   * throttled), in ms. Public routes: 2000. Without it LCP is
   * reported, not gated. The desktop profile is never gated. */
  lcpMobileMs?: number
}

export type PageLoadRoute = {
  name: string
  path: string
  budget: PageLoadBudget
}

export type PerfRoutes = {
  /** First-load JavaScript (scripts/perf/first-load.ts). `route` is the
   * route as Next.js names it: '/[username]/[slug]', '/shelf'. */
  firstLoad?: readonly {
    route: string
    budgetKb: number
    /** public: at most 150 KB; signed-in: at most 170 KB. */
    access: 'public' | 'signed-in'
  }[]
  /** Page-load budget (scripts/perf/page-load-budget.ts). `path` is a real
   * URL on the fixture backend. */
  pageLoad?: readonly PageLoadRoute[]
  /** Font fallback check (scripts/perf/font-fallback-check.ts). */
  fontFallback?: readonly {
    name: string
    path: string
    gateMovement: boolean
  }[]
}
