import { z } from 'zod'
import { pickRpcUrl, resolveStellarNetwork } from './network'
import { assertClientNetwork } from './network-guard'
import { TESTNET_FALLBACK_XLM_TO_USD_RATE } from './price-fallback'

// Stellar address pattern (G... for accounts, C... for contracts)
const stellarAddressSchema = z
  .string()
  .regex(/^[GC][A-Z0-9]{55}$/, 'Invalid Stellar address format')

// Environment validation schema
const envSchema = z.object({
  NEXT_PUBLIC_TIPPING_CONTRACT_ID: stellarAddressSchema.optional(),
  NEXT_PUBLIC_NFT_CONTRACT_ID: stellarAddressSchema.optional(),
  NEXT_PUBLIC_PLATFORM_ADDRESS: stellarAddressSchema.optional(),
})

// Validate environment variables at module load
function validateStellarEnv() {
  const env = {
    NEXT_PUBLIC_TIPPING_CONTRACT_ID:
      process.env.NEXT_PUBLIC_TIPPING_CONTRACT_ID || undefined,
    NEXT_PUBLIC_NFT_CONTRACT_ID:
      process.env.NEXT_PUBLIC_NFT_CONTRACT_ID || undefined,
    NEXT_PUBLIC_PLATFORM_ADDRESS:
      process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || undefined,
  }

  const result = envSchema.safeParse(env)

  if (!result.success) {
    const invalid = result.error.issues.map((i) => i.path.join('.')).join(', ')
    const message = `[Stellar Config] Invalid environment variables: ${invalid}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    } else if (typeof window !== 'undefined') {
      console.warn(`${message}. Some features may not work.`)
    }
  }

  // Warn about missing optional vars in development only (avoid production console noise)
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    if (!env.NEXT_PUBLIC_TIPPING_CONTRACT_ID) {
      console.warn(
        '[Stellar Config] NEXT_PUBLIC_TIPPING_CONTRACT_ID is not set. Tipping will not work.'
      )
    }
    if (!env.NEXT_PUBLIC_PLATFORM_ADDRESS) {
      console.warn(
        '[Stellar Config] NEXT_PUBLIC_PLATFORM_ADDRESS is not set. Platform fee collection disabled.'
      )
    }
  }
}

// Run validation
validateStellarEnv()

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

  // Contract addresses (2 contracts - Unified Tipping + NFT)
  // TIPPING_CONTRACT_ID handles BOTH article AND highlight tipping
  TIPPING_CONTRACT_ID: process.env.NEXT_PUBLIC_TIPPING_CONTRACT_ID || '',
  NFT_CONTRACT_ID: process.env.NEXT_PUBLIC_NFT_CONTRACT_ID || '',

  // Platform settings
  PLATFORM_ADDRESS: process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || '',
  PLATFORM_FEE_BPS: 250, // 2.5% platform fee

  // Tipping settings
  MINIMUM_TIP_STROOPS: 420000, // ~0.042 XLM (approximately 1 cent at $0.24/XLM)
  MINIMUM_TIP_CENTS: 1, // 1 cent minimum

  // NFT settings
  NFT_TIP_THRESHOLD_XLM: 10, // 10 XLM minimum tips to mint NFT
  NFT_TIP_THRESHOLD_STROOPS: 100_000_000, // 10 XLM in stroops
  NFT_METADATA_BASE_URL:
    process.env.NEXT_PUBLIC_NFT_METADATA_URL ||
    'https://quilltip.me/api/nft/metadata',
  NFT_ROYALTY_BPS: 500, // 5% royalty in basis points

  // Fallback conversion rate, used only on TESTNET when all price oracles
  // fail. On any other network the client refuses to quote instead.
  // Updated: Jan 2026 - Conservative rate based on recent market (~$0.21-0.24)
  XLM_TO_USD_RATE: TESTNET_FALLBACK_XLM_TO_USD_RATE,
} as const
