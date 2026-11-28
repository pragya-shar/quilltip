import type { AppCheck } from './types'

/** The pocket package's production-build checks. Owned by that package. */
export const checks: readonly AppCheck[] = [
  {
    // /pocket with JavaScript off, in Chromium and WebKit.
    name: 'balance page without scripts',
    command: [
      'bunx',
      'playwright',
      'test',
      '--config',
      'e2e/fixtures/pocket/app.config.ts',
    ],
  },
]
