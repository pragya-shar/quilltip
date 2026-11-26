/**
 * Fee constants shared with the contracts (contracts/shared/src/constants.rs):
 * the platform takes `floor(gross × 250 / 10,000)`; writers receive the rest.
 */
export const FEE_BPS = 250
export const BPS_DENOMINATOR = 10_000
