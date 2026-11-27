import { FIXTURE_ARTICLE_PATH } from '../convex-fixture'
import type { PerfRoutes } from './types'

/** The read package's measured routes. Owned by that package. */
export const routes: PerfRoutes = {
  // The article view: the target for every public reading route. It
  // replaces the legacy article page's 219 KB entry.
  firstLoad: [{ route: '/[username]/[slug]', budgetKb: 150 }],
  // The plan's targets for public reading: CLS at most 0.05 (both
  // profiles) and a median phone LCP of at most 2.0 s, both gated. Byte
  // budgets kept from the legacy article page until CI measures this one.
  pageLoad: [
    {
      name: 'article',
      path: FIXTURE_ARTICLE_PATH,
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101, cls: 0.05, lcpMs: 2000 },
    },
  ],
  // Source Serif 4 and its next/font fallback, on the real article.
  fontFallback: [
    { name: 'article', path: FIXTURE_ARTICLE_PATH, gateMovement: true },
  ],
}
