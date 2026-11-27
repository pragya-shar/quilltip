import type { PerfRoutes } from './types'

/**
 * The pocket package's measured routes. Owned by that package.
 *
 * `/pocket` is a signed-in route: first-load JavaScript at most 170 KB
 * (gzip), LCP at most 2.5 s on the phone profile, CLS at most 0.05. It is
 * the one route allowed to load components/pocket in its first load; the
 * declared sheets still load only when they open.
 */
export const routes: PerfRoutes = {
  firstLoad: [{ route: '/pocket', budgetKb: 170 }],
  pageLoad: [
    {
      name: 'balance page',
      path: '/pocket',
      budget: {
        htmlKb: 44,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2500,
      },
    },
  ],
}
