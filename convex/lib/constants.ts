/**
 * Re-exports app constants for Convex. Convex deployment only bundles convex/,
 * so we define values here to avoid importing from outside the convex folder.
 * Keep in sync with lib/constants.ts.
 */
export const TIP_MIN_CENTS = 1
export const TIP_MIN_USD = 0.01
export const TIP_MAX_CENTS = 10_000
export const TIP_MAX_USD = 100
export const MIN_WITHDRAWAL_USD = 10

// Minimum time between successive tips from the same user, across both
// article tips and highlight tips. Prevents accidental double-submits and
// basic spam during beta.
export const TIP_COOLDOWN_MS = 10_000

// Horizon endpoints for transaction verification. Can be overridden with the
// HORIZON_URL environment variable at deploy time; otherwise the per-network
// default is used based on the tip's stellarNetwork field.
export const HORIZON_URLS = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
} as const

// First verification attempt runs after this delay so Horizon has time to
// index the transaction we just submitted. Retry fires after the longer
// delay if the first attempt returns a transient failure (404, 5xx, network).
export const HORIZON_VERIFY_INITIAL_DELAY_MS = 2_000
export const HORIZON_VERIFY_RETRY_DELAY_MS = 5_000
export const HORIZON_VERIFY_MAX_ATTEMPTS = 2
