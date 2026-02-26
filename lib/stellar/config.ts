import { z } from 'zod'

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

  // Warn about missing optional vars that affect functionality
  if (typeof window !== 'undefined') {
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

export const STELLAR_CONFIG = {
  // Network configuration
  NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET',
  HORIZON_URL:
    process.env.NEXT_PUBLIC_HORIZON_URL ||
    'https://horizon-testnet.stellar.org',
  SOROBAN_RPC_URL:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
    'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ||
    'Test SDF Network ; September 2015',

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

  // Fallback conversion rate (used only when all price oracles fail)
  // Updated: Jan 2026 - Conservative rate based on recent market (~$0.21-0.24)
  XLM_TO_USD_RATE: 0.22,
} as const

export const TIP_AMOUNTS = [
  { cents: 1, label: '1¢' },
  { cents: 5, label: '5¢' },
  { cents: 10, label: '10¢' },
  { cents: 25, label: '25¢' },
  { cents: 50, label: '50¢' },
  { cents: 100, label: '$1' },
] as const
