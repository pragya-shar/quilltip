/**
 * The routes a package puts under the performance checks. Budgets follow
 * the rebuild plan (4.1): public routes at most 150 KB gzip of first-load
 * JavaScript, signed-in routes at most 170 KB.
 */
export type PerfRoutes = {
  /** First-load JavaScript (scripts/perf/first-load.ts). `route` is the
   * route as Next.js names it: '/[username]/[slug]', '/shelf'. */
  firstLoad?: readonly { route: string; budgetKb: number }[]
  /** Page-load budget (scripts/perf/page-load-budget.ts). `path` is a real
   * URL on the fixture backend. Compressed KB. */
  pageLoad?: readonly {
    name: string
    path: string
    budget: { htmlKb: number; cssKb: number; fontKb: number }
  }[]
  /** Font fallback check (scripts/perf/font-fallback-check.ts). */
  fontFallback?: readonly {
    name: string
    path: string
    gateMovement: boolean
  }[]
}
