import type { PerfRoutes } from './types'

/** The application shell's own routes (app/(app)). */
export const routes: PerfRoutes = {
  // The shell on a public reading page: its providers, navigation and design
  // system, with no legacy code.
  firstLoad: [{ route: '/system/reading', budgetKb: 150 }],
  // HTML and CSS held to the legacy article page's budget. Fonts: Literata
  // roman (60 KB, preloaded) and italic (62 KB, the sample has italics),
  // the design's reading face with optical sizing (N6, D23); the legacy
  // article's 101 KB carried two smaller faces.
  pageLoad: [
    {
      name: 'shell reading',
      path: '/system/reading',
      // CLS and LCP: the plan's public-route limits (4.1).
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
