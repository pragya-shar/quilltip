import type { PerfRoutes } from './types'

/** The application shell's own routes (app/(app)). */
export const routes: PerfRoutes = {
  // The shell on a public reading page: its providers, navigation and design
  // system, with no legacy code.
  firstLoad: [{ route: '/system/reading', budgetKb: 150 }],
  // Held to the legacy article page's budget until the real article replaces
  // both.
  pageLoad: [
    {
      name: 'shell reading',
      path: '/system/reading',
      // CLS and LCP: the plan's public-route limits (4.1).
      budget: { htmlKb: 44, cssKb: 28, fontKb: 101, cls: 0.05, lcpMs: 2000 },
    },
  ],
  // Source Serif 4 and its next/font fallback.
  fontFallback: [
    { name: 'shell reading', path: '/system/reading', gateMovement: true },
  ],
}
