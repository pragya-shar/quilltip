import type { PerfRoutes } from './types'

/**
 * The signin package's measured routes. Owned by that package. `/signin`
 * replaces the legacy `/login` in each check: a public page, LCP at most
 * 2 s on the phone profile and CLS at most 0.05. First-load JavaScript
 * (gzip) is the first measurement plus 2 KB, under the public ceiling: the
 * shell alone is about 185 KB until the backend client leaves public first
 * loads, so the 150 KB target is not reachable by these pages yet. The
 * sign-in sheet is declared and loads only when it opens.
 */
export const routes: PerfRoutes = {
  firstLoad: [
    // Measured 187.5 KB.
    { route: '/signin', budgetKb: 190, access: 'public' },
    // Measured 188.9 KB.
    { route: '/signin/reset', budgetKb: 191, access: 'public' },
  ],
  pageLoad: [
    {
      name: 'sign in',
      path: '/signin',
      budget: {
        htmlKb: 44,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2000,
      },
    },
  ],
  fontFallback: [{ name: 'sign in', path: '/signin', gateMovement: true }],
  // The no-script first response of both pages (scripts/app-checks/signin.ts).
  noScript: ['/signin', '/signin/reset'],
}
