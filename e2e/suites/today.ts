import type { FixtureSuite } from './types'

/**
 * The today package's fixture suites. Owned by that package.
 *
 * `today`: Today (`/`) rendered on the server and hydrated in the real
 * shell, with fake auth and drafts and the browser's real storage: the
 * opening, the rows without layout shift, empty and unreachable states,
 * widths 360 to 390, in Chromium and WebKit (its own config).
 */
export const suites: readonly FixtureSuite[] = [
  {
    name: 'today',
    server: 'e2e/fixtures/today/server.mjs',
    port: 4230,
    spec: 'e2e/today.spec.ts',
    config: 'e2e/fixtures/today/playwright.config.ts',
    env: {},
  },
]
