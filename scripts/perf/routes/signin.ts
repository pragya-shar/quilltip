import type { PerfRoutes } from './types'

/**
 * The signin package's measured routes. Owned by that package. `/signin`
 * replaces the legacy `/login` in each check: a public page, so at most
 * 150 KB of first-load JavaScript (gzip), LCP at most 2 s on the phone
 * profile and CLS at most 0.05. The sign-in sheet is declared and loads
 * only when it opens.
 */
export const routes: PerfRoutes = {
  firstLoad: [
    { route: '/signin', budgetKb: 150, access: 'public' },
    { route: '/signin/reset', budgetKb: 150, access: 'public' },
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
