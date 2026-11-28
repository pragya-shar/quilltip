/**
 * Re-exports app constants for Convex. Convex deployment only bundles convex/,
 * so we define values here to avoid importing from outside the convex folder.
 * Keep in sync with lib/constants.ts.
 */
import { parseStellarNetwork, type StellarNetwork } from './stellarNetwork'
import { assertBackendTestnet } from './networkGuard'

export const TIP_MIN_CENTS = 1
export const TIP_MIN_USD = 0.01
export const TIP_MAX_CENTS = 10_000
export const TIP_MAX_USD = 100

// Network settings live in ./stellarNetwork so the client, wallet adapter,
// backend, and scripts share one definition. HORIZON_URL can override the
// Horizon endpoint at deploy time; otherwise the per-network default is used.
export { HORIZON_URLS, type StellarNetwork } from './stellarNetwork'

/**
 * Network the backend verifies and records. Payment flows are TESTNET-only:
 * LOCAL, any other value, a mainnet passphrase, or a mainnet Horizon or RPC
 * override fails closed.
 */
export function getStellarNetwork(): StellarNetwork {
  const network = assertBackendTestnet()
  parseStellarNetwork(process.env.STELLAR_NETWORK)
  return network
}
