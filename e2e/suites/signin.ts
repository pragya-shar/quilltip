import type { FixtureSuite } from './types'

/** The signin package's fixture suites. Owned by that package. */
export const suites: readonly FixtureSuite[] = [
  {
    // Sign in on the application shell with fixture auth: phone and desktop
    // in Chromium and WebKit, and /signin with no script.
    name: 'signin',
    server: 'e2e/fixtures/signin/server.mjs',
    port: 4250,
    spec: 'e2e/signin(-no-script)?.spec.ts',
    config: 'e2e/fixtures/signin/playwright.config.ts',
    env: { SIGNIN_FIXTURES: '1' },
  },
]
