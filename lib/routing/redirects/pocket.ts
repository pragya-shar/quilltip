import type { Redirect } from './types'

/**
 * The pocket package's redirects (rebuild plan 5.3). Owned by that package.
 *
 * `/dashboard` and `/dashboard/earnings` only forwarded to the stats page;
 * money now lives in the balance. The other `/dashboard/*` pages, and
 * `/wallet/practice` with `/guide` and `/status`, stay until the balance
 * can do what they do (see the pocket package's notes in its pull request).
 */
export const redirects: readonly Redirect[] = [
  { from: '/dashboard', to: '/pocket' },
  { from: '/dashboard/earnings', to: '/pocket' },
]
