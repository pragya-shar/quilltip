/**
 * Payments v2 settings read from the Convex environment
 * (docs/architecture/v2/06-app-integration.md, section 6.8).
 *
 * Every reader runs the network guard first: the chain layer records TESTNET
 * activity only.
 */
import { ConvexError } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import { assertBackendTestnet } from '../networkGuard'
import { STELLAR_NETWORK_DEFAULTS } from '../stellarNetwork'

type EnvLike = Record<string, string | undefined>

export type ChainEnv = {
  network: 'TESTNET'
  /** Identifies one deployment of the v2 contracts, e.g. `testnet-2026-12-01`. */
  chainEpoch: string
  rpcUrl: string
  passphrase: string
  coreContractId: string | null
  tabContractId: string | null
  nftContractId: string | null
  tokenContractId: string | null
  v2Enabled: boolean
}

/** Used when `CHAIN_EPOCH` is unset, so rows are still grouped and visible. */
export const UNSET_CHAIN_EPOCH = 'testnet-unset'

function contractIdOrNull(name: string, env: EnvLike): string | null {
  const value = env[name]?.trim()
  if (!value) return null
  if (!StrKey.isValidContract(value)) {
    throw new ConvexError({
      code: 'CHAIN_CONFIG_INVALID',
      message: `${name} is not a contract address.`,
    })
  }
  return value
}

/** The RPC URL for backend reads, after the network guard. */
export function backendRpcUrl(env: EnvLike = process.env): string {
  assertBackendTestnet(env)
  return env.STELLAR_RPC_URL?.trim() || STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl!
}

export function readChainEnv(env: EnvLike = process.env): ChainEnv {
  const network = assertBackendTestnet(env)
  return {
    network,
    chainEpoch: env.CHAIN_EPOCH?.trim() || UNSET_CHAIN_EPOCH,
    rpcUrl: backendRpcUrl(env),
    passphrase:
      env.NETWORK_PASSPHRASE?.trim() ||
      STELLAR_NETWORK_DEFAULTS.TESTNET.passphrase,
    coreContractId: contractIdOrNull('CORE_CONTRACT_ID', env),
    tabContractId: contractIdOrNull('TAB_CONTRACT_ID', env),
    nftContractId: contractIdOrNull('NFT_CONTRACT_ID', env),
    tokenContractId: contractIdOrNull('TOKEN_CONTRACT_ID', env),
    v2Enabled: env.CHAIN_V2_ENABLED?.trim() === 'true',
  }
}

/**
 * Gate for v2 prepare functions. Throws `CHAIN_V2_DISABLED` unless
 * `CHAIN_V2_ENABLED=true`. Verification, recheck and read paths do not use
 * this gate, so records prepared before a rollback still resolve.
 */
export function requireChainV2Enabled(env: EnvLike = process.env): ChainEnv {
  const chain = readChainEnv(env)
  if (!chain.v2Enabled) {
    throw new ConvexError({
      code: 'CHAIN_V2_DISABLED',
      message: 'Payments v2 is not enabled on this deployment.',
    })
  }
  return chain
}
