import type { PerfRoutes } from './types'

/** The application shell's own routes (app/(app)). */
export const routes: PerfRoutes = {
  // The shell on a public reading page: its providers, navigation and design
  // system, with no legacy code. Its first CI measurement was 180.9 KB:
  // React and the Next.js runtime, and the backend client with its auth,
  // are in every first load. Budget: that measurement plus 2, rounded up.
  // Moving the backend client out of public first loads brings it toward
  // the 150 KB target.
  firstLoad: [{ route: '/system/reading', budgetKb: 183, access: 'public' }],
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
