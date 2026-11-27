import type { AppCheck } from './types'

/**
 * The today package's production-build checks. Owned by that package.
 * `today`: Today's route with scripts off and on, in Chromium and WebKit:
 * the first response, Read more, the skip cookies, the redirects, the CSP
 * nonce on its inline script, the widths, and (when the backend can be
 * slowed and made to fail) the time limit and that a failure is not stored.
 */
export const checks: readonly AppCheck[] = [
  { name: 'today', command: ['bun', 'scripts/today/app-check.ts'] },
]
