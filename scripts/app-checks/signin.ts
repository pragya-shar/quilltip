import type { AppCheck } from './types'

/** The signin package's production-build checks. Owned by that package. */
export const checks: readonly AppCheck[] = [
  {
    // /signin and /signin/reset with JavaScript off, and the redirects from
    // the older sign-in pages, in Chromium and WebKit.
    name: 'sign-in pages without scripts',
    command: [
      'bunx',
      'playwright',
      'test',
      '--config',
      'e2e/fixtures/signin/app.config.ts',
    ],
  },
]
