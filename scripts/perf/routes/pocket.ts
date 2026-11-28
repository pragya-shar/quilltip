import type { PerfRoutes } from './types'

/**
 * The pocket package's measured routes. Owned by that package.
 *
 * `/pocket` is a signed-in route: LCP at most 2.5 s on the phone profile,
 * CLS at most 0.05. It is the one route allowed to load components/pocket
 * in its first load; the declared sheets, the payments shell and its engine
 * load only through import().
 */
export const routes: PerfRoutes = {
  firstLoad: [
    // Measured 179.9 KB gzip: the page server-renders a placeholder and
    // imports the balance after hydration. The budget keeps room for the
    // shell's own growth, within the signed-in ceiling of 195.
    { route: '/pocket', budgetKb: 187, access: 'signed-in' },
  ],
  pageLoad: [
    {
      name: 'balance page',
      path: '/pocket',
      budget: {
        htmlKb: 44,
        cssKb: 28,
        fontKb: 101,
        cls: 0.05,
        lcpMobileMs: 2500,
        // Signed in from the browser's session: the server HTML holds the
        // heading and the reserved space, not who is here or their figures.
        lcpInServerHtml: false,
      },
    },
  ],
  // /dashboard answers 308 to /pocket (lib/routing/redirects/pocket.ts).
  // The server cannot know the session, so a signed-out reader stays on
  // /pocket, which asks to sign in with a plain link back to it.
  signedOutLanding: [
    { path: '/dashboard', endsAt: '/pocket', signInLink: 'Sign in' },
  ],
}
