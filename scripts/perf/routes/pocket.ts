import type { PerfRoutes } from './types'

/**
 * The pocket package's measured routes. Owned by that package.
 *
 * `/pocket` is a signed-in route: LCP at most 2.5 s on the phone profile,
 * CLS at most 0.05. It is the one route allowed to load components/pocket
 * in its first load; the declared sheets, the payments shell and its engine
 * load only through import().
 */
export const routes: PerfRoutes = {
  firstLoad: [
    // Measured 184.5 KB gzip (the shell alone is about 181): the first CI
    // measurement plus 2 KB, within the signed-in ceiling of 195.
    { route: '/pocket', budgetKb: 187, access: 'signed-in' },
  ],
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
