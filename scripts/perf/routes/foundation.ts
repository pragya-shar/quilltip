import type { PerfRoutes } from './types'

/** The application shell's own routes (app/(app)). */
export const routes: PerfRoutes = {
  // The shell on a public reading page: its providers, navigation and design
  // system, with no legacy code. Its first CI measurement was 180.9 KB:
  // React and the Next.js runtime, and the backend client with its auth,
  // are in every first load. Budget: that measurement plus 2, rounded up.
  // Moving the backend client out of public first loads brings it toward
  // the 150 KB target.
  firstLoad: [
    // With the sign-out state, the money store, the link rule and the
    // segment registry, the press guard, the app history and the focus
    // watchers, it measured 184.6 KB on a local production build: that
    // plus 2, rounded up.
    //
    // What each package adds to every page's first load, one line each,
    // so the budget has an account and not only a limit:
    // - base with the balance page: about 186.9 KB.
    // - signin: 0.4 KB, the sign-in sheet's declaration with its title
    //   reader (the title says the act, drawn before the sheet loads),
    //   openSignIn and signInHref; the intent rules (1.4 KB) load with the
    //   sheet. Measured 187.3 KB: budget 189.
    { route: '/system/reading', budgetKb: 189, access: 'public' },
    // The placeholder until the Shelf package's page replaces it: the same
    // shell as the reading sample, so the same budget until its first
    // measurement (then that plus 2). It drops out when
    // scripts/perf/routes/shelf.ts names /shelf; nothing here changes.
    { route: '/shelf', budgetKb: 183, access: 'public' },
  ],
  // e2e/reading-no-script.spec.ts, in the "reading without scripts" check.
  noScript: ['/system/reading', '/system/unreachable', '/shelf'],
  unmeasured: [
    {
      route: '/system',
      reason:
        'The design system gallery: every component and its demos, noindex, for builders and review; not a page readers reach.',
    },
    {
      route: '/system/unreachable',
      reason:
        'A sample of the unreachable state; its first load is the reading sample, which is measured.',
    },
  ],
  // HTML and CSS held to the legacy article page's budget. Fonts: Literata
  // roman (60 KB, preloaded) and italic (62 KB, the sample has italics),
  // the design's reading face with optical sizing; the legacy
  // article's 101 KB carried two smaller faces.
  pageLoad: [
    {
      name: 'shell reading',
      path: '/system/reading',
      // CLS and LCP at the public-route limits.
      budget: {
        htmlKb: 44,
        cssKb: 28,
        fontKb: 125,
        cls: 0.05,
        lcpMobileMs: 2000,
      },
    },
  ],
  // Literata and its next/font fallback.
  fontFallback: [
    { name: 'shell reading', path: '/system/reading', gateMovement: true },
  ],
}
