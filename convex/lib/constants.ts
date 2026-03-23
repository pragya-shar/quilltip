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
