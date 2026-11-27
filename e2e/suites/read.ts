import type { FixtureSuite } from './types'

/** The read package's fixture suites. Owned by that package. */
export const suites: readonly FixtureSuite[] = [
  {
    // The article view on a fake payments runtime: choosing a line, the
    // tip bar by touch and keyboard, the tip exactly once across a reload,
    // the receipt sheet, the reader's place, and the shared sentence
    // vectors in each engine. 390 with touch and 1440, in Chromium and
    // WebKit (its own config).
    name: 'read',
    server: 'e2e/fixtures/read/server.mjs',
    port: 4220,
    spec: 'e2e/read.spec.ts',
    config: 'e2e/fixtures/read/playwright.config.ts',
    env: { READ_FIXTURES: '1' },
  },
]
