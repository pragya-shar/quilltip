import type { PerfRoutes } from './types'

/**
 * Today (`/`), which replaced the landing page, held to the budget for a
 * public route: first-load JavaScript at its first CI measurement plus 2 KB
 * (at most 195 KB for now; the target stays 150 KB), CLS at most 0.05 (both
 * profiles) and a median phone LCP of at most 2.0 s, gated. The fixture
 * suite (e2e/today.spec.ts) holds the rows to zero layout shift.
 */
export const routes: PerfRoutes = {
  firstLoad: [
    // To be set from the first CI measurement.
    { route: '/', access: 'public', budgetKb: 195 },
  ],
  // Its first response with no script is checked on a production build
  // (scripts/today/app-check.ts, e2e/today-app.spec.ts).
  noScript: ['/'],
  pageLoad: [
    {
      name: 'today',
      path: '/',
      budget: {
        htmlKb: 44,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2000,
      },
    },
  ],
  fontFallback: [{ name: 'today', path: '/', gateMovement: true }],
}
