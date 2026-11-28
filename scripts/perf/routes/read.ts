import { FIXTURE_ARTICLE_PATH } from '../convex-fixture'
import type { PerfRoutes } from './types'

/** The read package's measured routes. Owned by that package. */
export const routes: PerfRoutes = {
  // The article view. It replaces the legacy article page's 219 KB entry.
  // 195 KB, the public ceiling for now: to be set from the first CI
  // measurement (that number plus 2 KB). The target stays 150 KB, for when
  // the backend client leaves the first load of public pages.
  firstLoad: [{ route: '/[username]/[slug]', budgetKb: 195, access: 'public' }],
  // Its first response with no script: scripts/app-checks/read.ts.
  noScript: ['/[username]/[slug]'],
  // The targets for public reading: CLS at most 0.05 (both
  // profiles) and a median phone LCP of at most 2.0 s, both gated. Byte
  // budgets kept from the legacy article page until CI measures this one.
  // Measured locally: HTML 45 KB (the full text is in the first response),
  // stylesheets 15 KB, fonts 59 KB.
  pageLoad: [
    {
      name: 'article',
      path: FIXTURE_ARTICLE_PATH,
      budget: {
        htmlKb: 48,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2000,
      },
    },
  ],
  // Source Serif 4 and its next/font fallback, on the real article.
  fontFallback: [
    { name: 'article', path: FIXTURE_ARTICLE_PATH, gateMovement: true },
  ],
  // The article is a pushed screen: the shell's back link (a plain link to
  // Today) is its way home, also on the unreachable state.
  wayHome: [
    {
      path: FIXTURE_ARTICLE_PATH,
      wayHome: { within: 'main', role: 'link', name: 'Back to Today' },
    },
  ],
}
