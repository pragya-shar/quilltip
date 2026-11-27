import type { PerfRoutes } from './types'

/**
 * Today (`/`), which replaced the landing page: the rebuild plan's public
 * route budget (4.1): at most 150 KB of first-load JavaScript, CLS at most
 * 0.05 (both profiles) and a median phone LCP of at most 2.0 s, gated. The
 * fixture suite (e2e/today.spec.ts) holds the rows to zero layout shift.
 */
export const routes: PerfRoutes = {
  firstLoad: [{ route: '/', budgetKb: 150 }],
  pageLoad: [
    {
      name: 'today',
      path: '/',
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101, cls: 0.05, lcpMs: 2000 },
    },
  ],
  fontFallback: [{ name: 'today', path: '/', gateMovement: true }],
}
