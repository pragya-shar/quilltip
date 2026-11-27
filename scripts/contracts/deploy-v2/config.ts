/**
 * Constructor values and roles for the v2 testnet deployment
 * (docs/architecture/v2/08-testing-and-deployment.md, section 8.4, and
 * 05-flows-and-admin.md, section 5.11).
 */

/** The three contracts, in deployment order: Tab and the NFT need Core. */
export const CONTRACTS = ['core', 'tab', 'nft'] as const
export type ContractName = (typeof CONTRACTS)[number]

/** Wasm file names produced by scripts/contracts/build-reproducible.sh. */
export const WASM_FILES: Record<ContractName, string> = {
  core: 'quilltip_core.wasm',
  tab: 'quilltip_tab.wasm',
  nft: 'quilltip_article_nft.wasm',
}

/** Contract sets. Each set has its own keys and contracts. */
export const SETS = ['integration', 'live', 'v3'] as const
export type ContractSet = (typeof SETS)[number]

/**
 * Per-set defaults. `baseRef` is the branch a testnet commit must be on,
 * `evidence` the repo path of the evidence document on testnet, and
 * `convexDeployment` the non-production Convex deployment that runs the set
 * (none for `live`).
 */
export const SET_DEFAULTS: Record<
  ContractSet,
  { baseRef: string; evidence: string; convexDeployment?: string }
> = {
  integration: {
    baseRef: 'origin/overhaul/v2',
    evidence: 'docs/contracts/v2-testnet-deployment.md',
    convexDeployment: 'efficient-tern-39',
  },
  live: {
    baseRef: 'origin/overhaul/v2',
    evidence: 'docs/contracts/v2-testnet-deployment.md',
  },
  v3: {
    baseRef: 'origin/overhaul/v3',
    evidence: 'docs/contracts/v3-testnet-deployment.md',
    convexDeployment: 'tacit-salmon-216',
  },
}

/**
 * Keys per set. `acceptor` signs voucher acceptances off chain and is never
 * funded. The others are Stellar accounts funded by Friendbot.
 */
export const ROLE_KEYS = [
  'deployer',
  'admin',
  'pauser',
  'upgrader',
  'treasury',
  'settler',
  'acceptor',
] as const
export type RoleKey = (typeof ROLE_KEYS)[number]
export const UNFUNDED_KEYS: readonly RoleKey[] = ['acceptor']

/** Throwaway accounts for the smoke flows. */
export const SMOKE_KEYS = ['author', 'tipper', 'reader', 'session'] as const
export type SmokeKey = (typeof SMOKE_KEYS)[number]
export const UNFUNDED_SMOKE_KEYS: readonly SmokeKey[] = ['session']

/** Section 8.4 constructor values, in stroops. */
export const CORE_MIN_TIP = BigInt(1_000_000) // 0.1 XLM
export const TAB_MAX_BALANCE = BigInt(10_000_000_000) // 1,000 XLM
export const TAB_MIN_DEPOSIT = BigInt(10_000_000) // 1 XLM
export const NFT_THRESHOLD = BigInt(500_000_000) // 50 XLM
export const DEFAULT_NFT_BASE_URI = 'https://www.quilltip.me/api/nft/'

/** Fixed contract constants the read-back also checks. */
export const FEE_BPS = 250
export const SCHEMA_VERSION = 1
export const NFT_NAME = 'QuillTip Article'
export const NFT_SYMBOL = 'QTART'

/** Role symbols (01-architecture.md, section 1.5). */
export const ROLE_SYMBOLS = {
  pauser: 'pauser',
  upgrader: 'upgrader',
  settler: 'settler',
} as const

/** Roles each contract grants in its constructor. No `manager` role. */
export const CONTRACT_ROLES: Record<
  ContractName,
  ReadonlyArray<keyof typeof ROLE_SYMBOLS>
> = {
  core: ['pauser', 'upgrader'],
  tab: ['pauser', 'upgrader', 'settler'],
  nft: ['pauser', 'upgrader'],
}

/** Identity name for a key in the set's Stellar CLI config directory. */
export function identityName(set: ContractSet, key: string): string {
  return `qt-v2-${set}-${key}`
}
