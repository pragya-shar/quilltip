/**
 * A check that needs a real production build (`next build`, then `next
 * start` on the fixture backend): redirects the proxy answers, the CSP on a
 * route, a slow backend, the no-script first response, crossing between the
 * root layouts. `command` runs from the repository root once the app
 * answers, with these in its environment:
 * - `PLAYWRIGHT_BASE_URL` and `APP_BASE_URL`: the app's origin;
 * - `NEXT_PUBLIC_CONVEX_URL`: the fixture backend;
 * - `NO_SCRIPT_CHECK=1` and `QUILLTIP_E2E_FIXTURES=1`.
 * It passes when it exits 0. Run Playwright in Chromium and WebKit.
 */
export type AppCheck = {
  /** Unique across all packages; shown in the log. */
  name: string
  command: readonly string[]
}
