import type { PerfRoutes } from './types'

/**
 * Today (`/`), which replaced the landing page: the rebuild plan's public
 * route budget (4.1). The rule of 4.1 also asks for LCP at most 2.0 s and
 * CLS at most 0.05; the page-load check gates CLS at its own 0.1 and reports
 * LCP until its entries can carry per-route targets. The fixture suite
 * (e2e/today.spec.ts) holds the rows to zero layout shift.
 */
export const routes: PerfRoutes = {
  firstLoad: [{ route: '/', budgetKb: 150 }],
  pageLoad: [
    {
      name: 'today',
      path: '/',
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101 },
    },
  ],
  fontFallback: [{ name: 'today', path: '/', gateMovement: true }],
}
