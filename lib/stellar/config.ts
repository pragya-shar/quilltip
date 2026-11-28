import { pickRpcUrl, resolveStellarNetwork } from './network'
import { assertClientNetwork } from './network-guard'

// Next.js inlines NEXT_PUBLIC_* values only for literal property access, so
// each value is read explicitly here. Invalid combinations throw at load.
export const STELLAR_NETWORK_CONFIG = resolveStellarNetwork({
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  passphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL,
  // NEXT_PUBLIC_SOROBAN_RPC_URL is the earlier name; both may be set only to
  // the same value.
  rpcUrl: pickRpcUrl(
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL
  ),
})

// The app signs and submits TESTNET transactions, or LOCAL ones against a
// local standalone network and local Convex backend. Any other network,
// passphrase, or a mainnet endpoint throws here, before any wallet call.
assertClientNetwork({
  ...STELLAR_NETWORK_CONFIG,
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
})

export const STELLAR_CONFIG = {
  // Network configuration (see lib/stellar/network.ts)
  NETWORK: STELLAR_NETWORK_CONFIG.network,
  HORIZON_URL: STELLAR_NETWORK_CONFIG.horizonUrl,
  SOROBAN_RPC_URL: STELLAR_NETWORK_CONFIG.rpcUrl,
  NETWORK_PASSPHRASE: STELLAR_NETWORK_CONFIG.passphrase,
  WALLET_NETWORK: STELLAR_NETWORK_CONFIG.walletNetwork,
} as const
