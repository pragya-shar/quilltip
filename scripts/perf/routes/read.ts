import { FIXTURE_ARTICLE_PATH } from '../convex-fixture'
import type { PerfRoutes } from './types'

/** The read package's measured routes. Owned by that package. */
export const routes: PerfRoutes = {
  // The article view: the rebuild plan's target for public reading routes
  // (4.1). It replaces the legacy article page's 219 KB entry.
  firstLoad: [{ route: '/[username]/[slug]', budgetKb: 150 }],
  // Byte budgets kept from the legacy article page until CI measures this
  // one. The plan's CLS 0.05 and LCP 2.0 s for this route wait on a field
  // for them in PerfRoutes (asked of the foundation).
  pageLoad: [
    {
      name: 'article',
      path: FIXTURE_ARTICLE_PATH,
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101 },
    },
  ],
  // Source Serif 4 and its next/font fallback, on the real article.
  fontFallback: [
    { name: 'article', path: FIXTURE_ARTICLE_PATH, gateMovement: true },
  ],
}
