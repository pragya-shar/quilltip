/**
 * Payments v2 client configuration (docs/architecture/v2/06-app-integration.md,
 * section 6.6): network, RPC URL, passphrase and contract IDs, validated.
 *
 * The network guard runs first: only TESTNET, or LOCAL against a local
 * standalone network and a local Convex backend. Any mainnet setting,
 * passphrase or endpoint throws before a wallet is asked to sign.
 */
import { StrKey } from '@stellar/stellar-sdk'
import { assertClientNetwork, type GuardedNetwork } from '../network-guard'
import { pickRpcUrl, resolveStellarNetwork } from '../network'

export type V2ConfigEnv = {
  network?: string
  passphrase?: string
  rpcUrl?: string
  legacyRpcUrl?: string
  horizonUrl?: string
  convexUrl?: string
  coreContractId?: string
  tabContractId?: string
  nftContractId?: string
  tokenContractId?: string
  /** The v1 NFT contract (`NEXT_PUBLIC_NFT_CONTRACT_ID`); must differ. */
  v1NftContractId?: string
}

export type V2ClientConfig = {
  network: GuardedNetwork
  passphrase: string
  rpcUrl: string
  /** Plain HTTP is allowed only for a LOCAL network on this machine. */
  allowHttp: boolean
  coreContractId: string | null
  tabContractId: string | null
  nftContractId: string | null
  tokenContractId: string | null
}

export class V2ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'V2ConfigError'
  }
}

function contractId(name: string, value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!StrKey.isValidContract(trimmed)) {
    throw new V2ConfigError(`${name} is not a contract address.`)
  }
  return trimmed
}

/** Validates a v2 configuration. Pure, for tests and `v2Config()`. */
export function readV2Config(env: V2ConfigEnv): V2ClientConfig {
  const resolved = resolveStellarNetwork({
    network: env.network,
    passphrase: env.passphrase,
    horizonUrl: env.horizonUrl,
    rpcUrl: pickRpcUrl(env.rpcUrl, env.legacyRpcUrl),
  })
  const network = assertClientNetwork({ ...resolved, convexUrl: env.convexUrl })
  const nftContractId = contractId(
    'NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID',
    env.nftContractId
  )
  if (nftContractId && nftContractId === env.v1NftContractId?.trim()) {
    throw new V2ConfigError(
      'NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID names the v1 NFT contract (NEXT_PUBLIC_NFT_CONTRACT_ID).'
    )
  }
  return {
    network,
    passphrase: resolved.passphrase,
    rpcUrl: resolved.rpcUrl,
    allowHttp: network === 'LOCAL',
    coreContractId: contractId(
      'NEXT_PUBLIC_CORE_CONTRACT_ID',
      env.coreContractId
    ),
    tabContractId: contractId('NEXT_PUBLIC_TAB_CONTRACT_ID', env.tabContractId),
    nftContractId,
    tokenContractId: contractId(
      'NEXT_PUBLIC_TOKEN_CONTRACT_ID',
      env.tokenContractId
    ),
  }
}

let cached: V2ClientConfig | null = null

/**
 * The app's v2 configuration. Next.js inlines `NEXT_PUBLIC_*` values only for
 * literal property access, so each is read explicitly.
 */
export function v2Config(): V2ClientConfig {
  cached ??= readV2Config({
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    passphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    legacyRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL,
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    coreContractId: process.env.NEXT_PUBLIC_CORE_CONTRACT_ID,
    tabContractId: process.env.NEXT_PUBLIC_TAB_CONTRACT_ID,
    // Not NEXT_PUBLIC_NFT_CONTRACT_ID: that name holds the v1 NFT contract
    // until the v1 code is removed, so the two can never point at each other.
    nftContractId: process.env.NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID,
    tokenContractId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
    v1NftContractId: process.env.NEXT_PUBLIC_NFT_CONTRACT_ID,
  })
  return cached
}
