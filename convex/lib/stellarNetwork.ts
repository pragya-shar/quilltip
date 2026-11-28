/**
 * Single source of truth for Stellar network settings.
 *
 * The Next.js client, the wallet adapter, the Convex backend, and local
 * scripts all resolve their network through this module. It has no imports so
 * Convex can bundle it and client code can import it through
 * `@/lib/stellar/network`.
 */

/** Networks a payment record can be on. */
export const STELLAR_NETWORKS = ['TESTNET', 'MAINNET'] as const
export type StellarNetwork = (typeof STELLAR_NETWORKS)[number]

/**
 * Values of the network setting (`NEXT_PUBLIC_STELLAR_NETWORK`,
 * `STELLAR_NETWORK`). `LOCAL` is a Stellar Quickstart standalone network on
 * this machine, for integration tests and CI only.
 */
export const STELLAR_NETWORK_SETTINGS = ['TESTNET', 'MAINNET', 'LOCAL'] as const
export type StellarNetworkSetting = (typeof STELLAR_NETWORK_SETTINGS)[number]

export const DEFAULT_STELLAR_NETWORK: StellarNetwork = 'TESTNET'

/** Key of the `Networks` enum in @creit.tech/stellar-wallets-kit 2.x. */
export type WalletNetworkKey = 'TESTNET' | 'PUBLIC' | 'STANDALONE'

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
export const MAINNET_PASSPHRASE =
  'Public Global Stellar Network ; September 2015'
/** Stellar Quickstart `--local` (standalone) network passphrase. */
export const LOCAL_PASSPHRASE = 'Standalone Network ; February 2017'

type NetworkDefaults = {
  walletNetwork: WalletNetworkKey
  passphrase: string
  horizonUrl: string
  /** SDF runs no public mainnet RPC, so MAINNET needs an explicit RPC URL. */
  rpcUrl: string | null
  /** Network name the Stellar CLI uses for `--network`. */
  cliNetwork: 'testnet' | 'mainnet' | 'local'
  explorerSegment: 'testnet' | 'public' | null
}

export const STELLAR_NETWORK_DEFAULTS: Record<
  StellarNetworkSetting,
  NetworkDefaults
> = {
  TESTNET: {
    walletNetwork: 'TESTNET',
    passphrase: TESTNET_PASSPHRASE,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    cliNetwork: 'testnet',
    explorerSegment: 'testnet',
  },
  MAINNET: {
    walletNetwork: 'PUBLIC',
    passphrase: MAINNET_PASSPHRASE,
    horizonUrl: 'https://horizon.stellar.org',
    rpcUrl: null,
    cliNetwork: 'mainnet',
    explorerSegment: 'public',
  },
  // Stellar Quickstart serves Horizon and RPC on port 8000.
  LOCAL: {
    walletNetwork: 'STANDALONE',
    passphrase: LOCAL_PASSPHRASE,
    horizonUrl: 'http://localhost:8000',
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    cliNetwork: 'local',
    explorerSegment: null,
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

export function isStellarNetworkSetting(
  value: unknown
): value is StellarNetworkSetting {
  return (
    typeof value === 'string' &&
    (STELLAR_NETWORK_SETTINGS as readonly string[]).includes(value)
  )
}

function parseNetworkValue(
  value: string | undefined | null,
  source: string,
  accepted: readonly string[]
): string {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') return DEFAULT_STELLAR_NETWORK
  if (accepted.includes(trimmed)) return trimmed
  if (trimmed.toUpperCase() === 'PUBLIC') {
    throw new StellarNetworkConfigError(
      `${source}=PUBLIC is not supported. Use MAINNET or TESTNET.`
    )
  }
  throw new StellarNetworkConfigError(
    `${source} must be ${accepted.join(' or ')} (received "${trimmed}").`
  )
}

/**
 * Parse a recorded network value. An unset or empty value means TESTNET. Any
 * other value must be exactly `TESTNET` or `MAINNET`; `PUBLIC` is rejected so
 * one name is used everywhere.
 */
export function parseStellarNetwork(
  value: string | undefined | null,
  source = 'STELLAR_NETWORK'
): StellarNetwork {
  return parseNetworkValue(value, source, STELLAR_NETWORKS) as StellarNetwork
}

/** Parse the network setting, which also accepts `LOCAL`. */
export function parseStellarNetworkSetting(
  value: string | undefined | null,
  source = 'STELLAR_NETWORK'
): StellarNetworkSetting {
  return parseNetworkValue(
    value,
    source,
    STELLAR_NETWORK_SETTINGS
  ) as StellarNetworkSetting
}

/**
 * Pick the RPC URL from the current variable and the earlier
 * `NEXT_PUBLIC_SOROBAN_RPC_URL` name. Both may be set only to the same value.
 */
export function pickRpcUrl(
  current: string | null | undefined,
  legacy: string | null | undefined,
  names = 'NEXT_PUBLIC_STELLAR_RPC_URL and NEXT_PUBLIC_SOROBAN_RPC_URL'
): string | undefined {
  const a = blankToUndefined(current)
  const b = blankToUndefined(legacy)
  if (a && b && a !== b) {
    throw new StellarNetworkConfigError(`${names} are both set and differ.`)
  }
  return a ?? b
}

export type StellarNetworkEnv = {
  network?: string | null
  passphrase?: string | null
  horizonUrl?: string | null
  rpcUrl?: string | null
}

export type ResolvedStellarNetwork = {
  network: StellarNetworkSetting
  walletNetwork: WalletNetworkKey
  passphrase: string
  horizonUrl: string
  rpcUrl: string
  cliNetwork: 'testnet' | 'mainnet' | 'local'
  explorerSegment: 'testnet' | 'public' | null
}

function blankToUndefined(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resolve the full network configuration from env values. This resolves
 * settings only; callers apply the network guard (`assertClientNetwork`,
 * `assertBackendNetwork`, `assertScriptTestnetOnly`). The passphrase is
 * fixed per network: an override that does not match the selected network is
 * a configuration error. Horizon and RPC URLs may point at another provider.
 */
export function resolveStellarNetwork(
  env: StellarNetworkEnv
): ResolvedStellarNetwork {
  const network = parseStellarNetworkSetting(env.network)
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
    cliNetwork: defaults.cliNetwork,
    explorerSegment: defaults.explorerSegment,
  }
}

export function stellarExpertTransactionUrl(
  network: StellarNetwork,
  transactionHash: string
): string {
  const segment = network === 'MAINNET' ? 'public' : 'testnet'
  return `https://stellar.expert/explorer/${segment}/tx/${transactionHash}`
}
