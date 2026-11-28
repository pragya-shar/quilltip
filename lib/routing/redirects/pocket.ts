import type { Redirect } from './types'

/**
 * The pocket package's redirects. Owned by that package. `/dashboard` only
 * forwarded to the stats page; money now lives in the balance.
 * `/dashboard/balance` and `/dashboard/earnings` stay while the testnet
 * real-run scripts (e2e/real-run) still read them; they redirect here when
 * those scripts read /pocket.
 */
export const redirects: readonly Redirect[] = [
  { from: '/dashboard', to: '/pocket' },
]
