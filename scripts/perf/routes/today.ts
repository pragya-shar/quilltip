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
      // Measured 54.8 KB of server HTML (9 KB gzip) on the fixture
      // backend: the shell's own page is 33 KB, and Today adds its opening
      // (up to 90 words) and the "More to read" items, each once in the HTML
      // and once in the page's server-component payload (about 2 KB an
      // item; each link is the shell's AppLink, a client component, so it
      // adds a reference and its props there), plus the row-reservation
      // script, also twice (2 KB). Budget: that measurement plus 2, for the
      // fixture's 8 list items; a live page shows up to 12 (about 8 KB more).
      budget: {
        htmlKb: 57,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2000,
      },
    },
  ],
  fontFallback: [{ name: 'today', path: '/', gateMovement: true }],
  // Today is in the application shell: its way home is the Today link in
  // the navigation, not the legacy header's wordmark.
  wayHome: [
    {
      path: '/',
      wayHome: { within: 'navigation', role: 'link', name: 'Today' },
    },
  ],
}
