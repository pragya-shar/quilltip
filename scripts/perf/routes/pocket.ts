import type { PerfRoutes } from './types'

/**
 * The pocket package's measured routes. Owned by that package.
 *
 * `/pocket` is a signed-in route (plan 4.1: LCP at most 2.5 s, CLS at most
 * 0.05). It is not in the first-load list: it is the one route that loads
 * components/pocket directly, which that check refuses everywhere else.
 */
export const routes: PerfRoutes = {
  pageLoad: [
    {
      name: 'balance page',
      path: '/pocket',
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101, cls: 0.05, lcpMs: 2500 },
    },
  ],
}
