import type { AppCheck } from './types'

/** The read package's production-build checks. Owned by that package. */
export const checks: readonly AppCheck[] = [
  {
    // The article with JavaScript off, real 404s, the paragraph anchor
    // and the route's content security policy; Chromium and WebKit.
    name: 'article without scripts',
    command: [
      'bunx',
      'playwright',
      'test',
      '--config',
      'e2e/fixtures/read/no-script.config.ts',
    ],
  },
]
