/**
 * Single source of truth for Stellar network settings.
 *
 * The Next.js client, the wallet adapter, the Convex backend, and local
 * scripts all resolve their network through this module. It has no imports so
 * Convex can bundle it and client code can import it through
 * `@/lib/stellar/network`.
 */

export const STELLAR_NETWORKS = ['TESTNET', 'MAINNET'] as const
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number]

export const DEFAULT_STELLAR_NETWORK: StellarNetwork = 'TESTNET'

/** Key of the `WalletNetwork` enum in @creit.tech/stellar-wallets-kit. */
export type WalletNetworkKey = 'TESTNET' | 'PUBLIC'

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
export const MAINNET_PASSPHRASE =
  'Public Global Stellar Network ; September 2015'

type NetworkDefaults = {
  walletNetwork: WalletNetworkKey
  passphrase: string
  horizonUrl: string
  /** SDF runs no public mainnet RPC, so MAINNET needs an explicit RPC URL. */
  rpcUrl: string | null
  explorerSegment: 'testnet' | 'public'
}

export const STELLAR_NETWORK_DEFAULTS: Record<StellarNetwork, NetworkDefaults> =
  {
    TESTNET: {
      walletNetwork: 'TESTNET',
      passphrase: TESTNET_PASSPHRASE,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerSegment: 'testnet',
    },
    MAINNET: {
      walletNetwork: 'PUBLIC',
      passphrase: MAINNET_PASSPHRASE,
      horizonUrl: 'https://horizon.stellar.org',
      rpcUrl: null,
      explorerSegment: 'public',
    },
  }

/** Horizon endpoints per network, kept for backend verification callers. */
export const HORIZON_URLS = {
  TESTNET: STELLAR_NETWORK_DEFAULTS.TESTNET.horizonUrl,
  MAINNET: STELLAR_NETWORK_DEFAULTS.MAINNET.horizonUrl,
} as const

export class StellarNetworkConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StellarNetworkConfigError'
  }
}

export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return (
    typeof value === 'string' &&
    (STELLAR_NETWORKS as readonly string[]).includes(value)
  )
}

/**
 * Parse a network env value. An unset or empty value means TESTNET. Any other
 * value must be exactly `TESTNET` or `MAINNET`; `PUBLIC` is rejected so one
 * name is used everywhere.
 */
export function parseStellarNetwork(
  value: string | undefined | null,
  source = 'STELLAR_NETWORK'
): StellarNetwork {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return DEFAULT_STELLAR_NETWORK
  if (isStellarNetwork(trimmed)) return trimmed
  if (trimmed.toUpperCase() === 'PUBLIC') {
    throw new StellarNetworkConfigError(
      `${source}=PUBLIC is not supported. Use MAINNET or TESTNET.`
    )
  }
  throw new StellarNetworkConfigError(
    `${source} must be TESTNET or MAINNET (received "${trimmed}").`
  )
}

export type StellarNetworkEnv = {
  network?: string | null
  passphrase?: string | null
  horizonUrl?: string | null
  rpcUrl?: string | null
}

export type ResolvedStellarNetwork = {
  network: StellarNetwork
  walletNetwork: WalletNetworkKey
  passphrase: string
  horizonUrl: string
  rpcUrl: string
  explorerSegment: 'testnet' | 'public'
}

function blankToUndefined(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resolve the full network configuration from env values. The passphrase is
 * fixed per network: an override that does not match the selected network is
 * a configuration error. Horizon and RPC URLs may point at another provider.
 */
export function resolveStellarNetwork(
  env: StellarNetworkEnv
): ResolvedStellarNetwork {
  const network = parseStellarNetwork(env.network)
  const defaults = STELLAR_NETWORK_DEFAULTS[network]

  const passphrase = blankToUndefined(env.passphrase) ?? defaults.passphrase
  if (passphrase !== defaults.passphrase) {
    throw new StellarNetworkConfigError(
      `Network passphrase does not match ${network}. Expected "${defaults.passphrase}".`
    )
  }

  const rpcUrl = blankToUndefined(env.rpcUrl) ?? defaults.rpcUrl
  if (!rpcUrl) {
    throw new StellarNetworkConfigError(
      `${network} has no default Soroban RPC URL. Set the RPC URL explicitly.`
    )
  }

  return {
    network,
    walletNetwork: defaults.walletNetwork,
    passphrase,
    horizonUrl: blankToUndefined(env.horizonUrl) ?? defaults.horizonUrl,
    rpcUrl,
    explorerSegment: defaults.explorerSegment,
  }
}

export function stellarExpertTransactionUrl(
  network: StellarNetwork,
  transactionHash: string
): string {
  const segment = STELLAR_NETWORK_DEFAULTS[network].explorerSegment
  return `https://stellar.expert/explorer/${segment}/tx/${transactionHash}`
}
