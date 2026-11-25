/**
 * Testnet-only guard.
 *
 * Scripts, deploy helpers, and operational tools call `assertTestnetOnly`
 * before they submit transactions or change a Convex deployment. The guard
 * fails closed: a missing or unknown value is a refusal, not a default.
 *
 * It applies two separate controls:
 *
 * 1. Stellar network. Only TESTNET is accepted. Mainnet networks,
 *    passphrases, and endpoints are refused always; nothing overrides this.
 * 2. Convex backend. Targets must be local or on an allowlist. The live
 *    backend is refused by default. An operational run (kind `operational`)
 *    may target it only when LIVE_BACKEND_APPROVAL_ENV names that deployment.
 *    Deploy-kind work (function pushes, schema pushes, imports, migrations,
 *    env changes) is refused on the live backend even with that approval.
 *
 * This module has no imports outside convex/lib so Convex, Next.js, and Bun
 * scripts can share it. Client code imports it through
 * `@/lib/stellar/network-guard`; scripts use `scripts/lib/network-guard.ts`.
 */

import {
  MAINNET_PASSPHRASE,
  STELLAR_NETWORK_DEFAULTS,
  TESTNET_PASSPHRASE,
} from './stellarNetwork'

/**
 * What the guarded tool does to the backend.
 * - `operational`: runs app or backend flows that record testnet activity.
 * - `deploy`: pushes functions or schema, imports data, runs migrations, or
 *   changes deployment env. Never allowed on a live backend.
 */
export type GuardedOperationKind = 'operational' | 'deploy'

/** Non-production Convex deployments any guarded tool may target. */
export const ALLOWED_CONVEX_DEPLOYMENTS: readonly string[] = [
  'efficient-tern-39',
]

/**
 * Convex deployments that serve the live site. Refused by default; see
 * LIVE_BACKEND_APPROVAL_ENV.
 */
export const LIVE_CONVEX_DEPLOYMENTS: readonly string[] = [
  'upbeat-mockingbird-579',
]

/** Kept for callers of the earlier name. */
export const PRODUCTION_CONVEX_DEPLOYMENTS = LIVE_CONVEX_DEPLOYMENTS

/** Env var that must equal OPT_IN_VALUE before a guarded operation runs. */
export const NETWORK_GUARD_OPT_IN_ENV = 'QUILLTIP_NETWORK_GUARD_OPT_IN'
export const NETWORK_GUARD_OPT_IN_VALUE = 'testnet'

/**
 * Optional comma-separated list of extra non-production deployments (for
 * example a personal dev deployment). Live deployment names are refused here.
 */
export const CONVEX_ALLOWLIST_ENV = 'QUILLTIP_CONVEX_ALLOWLIST'

/** Optional comma-separated list that adds to LIVE_CONVEX_DEPLOYMENTS. */
export const EXTRA_PRODUCTION_DEPLOYMENTS_ENV =
  'QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS'

/**
 * Named approval for an owner-approved operational run against a live
 * backend. Its value must be the live deployment name. Set it only for that
 * run, never in a shared .env file. It never applies to deploy-kind work.
 */
export const LIVE_BACKEND_APPROVAL_ENV =
  'QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL'

const TESTNET_HOSTS = new Set([
  new URL(STELLAR_NETWORK_DEFAULTS.TESTNET.horizonUrl).hostname,
  new URL(STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl ?? '').hostname,
  'friendbot.stellar.org',
])

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const KNOWN_MAINNET_HOSTS = new Set([
  new URL(STELLAR_NETWORK_DEFAULTS.MAINNET.horizonUrl).hostname,
  'mainnet.sorobanrpc.com',
  'soroban-rpc.mainnet.stellar.gateway.fm',
])

export type NetworkGuardCode =
  | 'MISSING_OPT_IN'
  | 'MISSING_NETWORK'
  | 'NOT_TESTNET'
  | 'CONFLICTING_NETWORK'
  | 'MAINNET_PASSPHRASE'
  | 'UNKNOWN_PASSPHRASE'
  | 'MAINNET_URL'
  | 'UNTRUSTED_URL'
  | 'INVALID_URL'
  | 'PROD_CONVEX_TYPE'
  | 'UNKNOWN_CONVEX'
  | 'CONVEX_NOT_ALLOWLISTED'
  | 'LIVE_BACKEND_NOT_APPROVED'
  | 'LIVE_BACKEND_DEPLOY'
  | 'LIVE_IN_ALLOWLIST'
  | 'APPROVAL_NOT_FOR_DEPLOY'
  | 'INVALID_APPROVAL'

export type NetworkGuardRefusal = {
  code: NetworkGuardCode
  message: string
}

export class NetworkGuardError extends Error {
  readonly refusals: NetworkGuardRefusal[]

  constructor(operation: string, refusals: NetworkGuardRefusal[]) {
    super(
      [
        `Network guard refused "${operation}". Guarded tools run on Stellar TESTNET and allowlisted Convex deployments only.`,
        ...refusals.map((r) => `  - [${r.code}] ${r.message}`),
      ].join('\n')
    )
    this.name = 'NetworkGuardError'
    this.refusals = refusals
  }

  get codes(): NetworkGuardCode[] {
    return this.refusals.map((r) => r.code)
  }
}

export type NetworkGuardInput = {
  /** Short name of the operation, used in the error message. */
  operation: string
  /** Defaults to `deploy`, the stricter kind. */
  kind?: GuardedOperationKind
  /** Stellar network values from every source in use; all must be TESTNET. */
  stellarNetworks?: Array<string | null | undefined>
  networkPassphrase?: string | null
  /** Horizon, RPC, or friendbot URLs the operation will contact. */
  stellarUrls?: Array<string | null | undefined>
  /** Convex URLs (`https://<name>.convex.cloud`, `.convex.site`, or local). */
  convexUrls?: Array<string | null | undefined>
  /** `CONVEX_DEPLOYMENT` value (`dev:name`, `prod:name`, `local:name`, `name`). */
  convexDeployment?: string | null
  /** `CONVEX_DEPLOY_KEY` value. Only its type prefix and name are read. */
  convexDeployKey?: string | null
  /** Value of QUILLTIP_NETWORK_GUARD_OPT_IN. */
  optIn?: string | null
  /** Value of QUILLTIP_CONVEX_ALLOWLIST. */
  extraAllowedDeployments?: string | null
  /** Value of QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS. */
  extraProductionDeployments?: string | null
  /** Value of QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL. */
  liveBackendApproval?: string | null
  /** Set false to skip Stellar checks for Convex-only tools. */
  checkStellar?: boolean
  /** Set false to skip Convex checks (backend network check only). */
  checkConvex?: boolean
  /** Set false to skip the opt-in check (backend runtime checks only). */
  requireOptIn?: boolean
  /**
   * Accept Stellar URLs on hosts outside the testnet allowlist (mainnet hosts
   * are still refused). Only the backend runtime check uses this, so a custom
   * testnet Horizon provider keeps working on deployed backends.
   */
  allowUnlistedUrls?: boolean
}

export type NetworkGuardResult = {
  network: 'TESTNET'
  convexDeployments: string[]
  /** True when an approved operational run targets a live backend. */
  liveBackendApproved: boolean
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function nameList(
  ...sources: Array<readonly string[] | string | null | undefined>
) {
  const names = new Set<string>()
  for (const source of sources) {
    const items =
      typeof source === 'string' ? source.split(',') : (source ?? [])
    for (const item of items) {
      const trimmed = item.trim().toLowerCase()
      if (trimmed) names.add(trimmed)
    }
  }
  return names
}

export function productionDeploymentDenylist(
  extra?: string | null
): Set<string> {
  return nameList(LIVE_CONVEX_DEPLOYMENTS, extra)
}

/** Deployment name from a Convex cloud/site URL, or null for local/other URLs. */
export function convexDeploymentNameFromUrl(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  const match = host.match(
    /^([a-z0-9-]+)(?:\.[a-z0-9-]+)?\.convex\.(?:cloud|site)$/
  )
  return match?.[1] ?? null
}

/** Split `dev:name|team`, `prod:name|...`, or `name` into type and name. */
export function parseConvexDeploymentRef(value: string): {
  type: string | null
  name: string
} {
  const trimmed = value.trim().toLowerCase()
  const colon = trimmed.indexOf(':')
  if (colon === -1) return { type: null, name: trimmed.split('|')[0] ?? '' }
  const type = trimmed.slice(0, colon)
  const name = trimmed.slice(colon + 1).split('|')[0] ?? ''
  return { type, name }
}

function checkStellarUrl(url: string): NetworkGuardRefusal | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { code: 'INVALID_URL', message: `"${url}" is not a valid URL.` }
  }
  const host = parsed.hostname.toLowerCase()
  if (KNOWN_MAINNET_HOSTS.has(host) || /(^|[.-])mainnet([.-]|$)/.test(host)) {
    return {
      code: 'MAINNET_URL',
      message: `${parsed.origin} is a Stellar mainnet endpoint.`,
    }
  }
  if (TESTNET_HOSTS.has(host) || LOCAL_HOSTS.has(host)) return null
  return {
    code: 'UNTRUSTED_URL',
    message: `${parsed.origin} is not a known testnet or local endpoint.`,
  }
}

/**
 * Collect every reason the operation must not run. Returns an empty list when
 * the inputs describe TESTNET and a non-production Convex deployment.
 */
export function collectNetworkGuardRefusals(
  input: NetworkGuardInput
): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  const checkStellar = input.checkStellar ?? true
  const requireOptIn = input.requireOptIn ?? true

  if (requireOptIn && input.optIn?.trim() !== NETWORK_GUARD_OPT_IN_VALUE) {
    refusals.push({
      code: 'MISSING_OPT_IN',
      message: `Set ${NETWORK_GUARD_OPT_IN_ENV}=${NETWORK_GUARD_OPT_IN_VALUE} to confirm this run targets testnet.`,
    })
  }

  if (checkStellar) {
    const networks = (input.stellarNetworks ?? []).filter(present)
    const distinct = new Set(networks.map((n) => n.trim()))
    if (distinct.size === 0) {
      refusals.push({
        code: 'MISSING_NETWORK',
        message:
          'No Stellar network is set. Set NEXT_PUBLIC_STELLAR_NETWORK=TESTNET (scripts) or STELLAR_NETWORK=TESTNET (Convex).',
      })
    } else if (distinct.size > 1) {
      refusals.push({
        code: 'CONFLICTING_NETWORK',
        message: `Stellar network values disagree: ${[...distinct].join(', ')}.`,
      })
    }
    for (const network of distinct) {
      if (network !== 'TESTNET') {
        refusals.push({
          code: 'NOT_TESTNET',
          message: `Stellar network is "${network}"; only TESTNET is allowed.`,
        })
      }
    }

    if (present(input.networkPassphrase)) {
      const passphrase = input.networkPassphrase.trim()
      if (passphrase === MAINNET_PASSPHRASE) {
        refusals.push({
          code: 'MAINNET_PASSPHRASE',
          message: 'The network passphrase is the Stellar mainnet passphrase.',
        })
      } else if (passphrase !== TESTNET_PASSPHRASE) {
        refusals.push({
          code: 'UNKNOWN_PASSPHRASE',
          message: `The network passphrase is not "${TESTNET_PASSPHRASE}".`,
        })
      }
    }

    for (const url of (input.stellarUrls ?? []).filter(present)) {
      const refusal = checkStellarUrl(url.trim())
      if (
        refusal &&
        !(input.allowUnlistedUrls && refusal.code === 'UNTRUSTED_URL')
      ) {
        refusals.push(refusal)
      }
    }
  }

  if (input.checkConvex ?? true) {
    refusals.push(...collectConvexRefusals(input).refusals)
  }

  return refusals
}

type ConvexTarget = { label: string; type: string | null; name: string }

function collectConvexRefusals(input: NetworkGuardInput): {
  refusals: NetworkGuardRefusal[]
  deployments: string[]
  liveBackendApproved: boolean
} {
  const refusals: NetworkGuardRefusal[] = []
  const kind = input.kind ?? 'deploy'
  const live = productionDeploymentDenylist(input.extraProductionDeployments)
  const extraAllowed = nameList(input.extraAllowedDeployments)
  const allowed = nameList(ALLOWED_CONVEX_DEPLOYMENTS)
  const approval = input.liveBackendApproval?.trim().toLowerCase() ?? ''

  for (const name of extraAllowed) {
    if (live.has(name)) {
      refusals.push({
        code: 'LIVE_IN_ALLOWLIST',
        message: `${CONVEX_ALLOWLIST_ENV} lists live deployment "${name}". Live backends cannot be allowlisted.`,
      })
    } else {
      allowed.add(name)
    }
  }

  if (approval) {
    if (kind === 'deploy') {
      refusals.push({
        code: 'APPROVAL_NOT_FOR_DEPLOY',
        message: `${LIVE_BACKEND_APPROVAL_ENV} applies only to approved operational runs, never to deploys, schema pushes, imports, or migrations. Unset it.`,
      })
    } else if (!live.has(approval)) {
      refusals.push({
        code: 'INVALID_APPROVAL',
        message: `${LIVE_BACKEND_APPROVAL_ENV} must name a live deployment.`,
      })
    }
  }

  const targets: ConvexTarget[] = []
  let hasLocalTarget = false
  for (const url of (input.convexUrls ?? []).filter(present)) {
    const trimmed = url.trim()
    let host = ''
    try {
      host = new URL(trimmed).hostname.toLowerCase()
    } catch {
      refusals.push({
        code: 'INVALID_URL',
        message: `"${trimmed}" is not a valid Convex URL.`,
      })
      continue
    }
    if (LOCAL_HOSTS.has(host)) {
      hasLocalTarget = true
      continue
    }
    const name = convexDeploymentNameFromUrl(trimmed)
    if (!name) {
      refusals.push({
        code: 'CONVEX_NOT_ALLOWLISTED',
        message: `${host} is not a Convex deployment URL on the allowlist.`,
      })
      continue
    }
    targets.push({ label: 'Convex URL', type: null, name })
  }

  for (const [label, value] of [
    ['CONVEX_DEPLOYMENT', input.convexDeployment],
    ['CONVEX_DEPLOY_KEY', input.convexDeployKey],
  ] as const) {
    if (!present(value)) continue
    const ref = parseConvexDeploymentRef(value)
    if (ref.type === 'local' || ref.type === 'anonymous') {
      hasLocalTarget = true
      continue
    }
    targets.push({ label, type: ref.type, name: ref.name })
  }

  if (targets.length === 0 && !hasLocalTarget) {
    refusals.push({
      code: 'UNKNOWN_CONVEX',
      message:
        'No Convex deployment is selected. Set CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to an allowlisted deployment.',
    })
  }

  let liveBackendApproved = false
  const seen = new Set<string>()
  for (const target of targets) {
    const key = `${target.label}:${target.name}`
    if (seen.has(key)) continue
    seen.add(key)

    if (live.has(target.name)) {
      if (kind === 'deploy') {
        refusals.push({
          code: 'LIVE_BACKEND_DEPLOY',
          message: `${target.label} targets live deployment "${target.name}". Deploys, schema pushes, imports, and migrations from developer tooling are never allowed there.`,
        })
      } else if (approval === target.name) {
        liveBackendApproved = true
      } else {
        refusals.push({
          code: 'LIVE_BACKEND_NOT_APPROVED',
          message: `${target.label} targets live deployment "${target.name}". An owner-approved operational run must set ${LIVE_BACKEND_APPROVAL_ENV}=${target.name}.`,
        })
      }
      continue
    }

    if (target.type === 'prod') {
      refusals.push({
        code: 'PROD_CONVEX_TYPE',
        message: `${target.label} selects a production-type Convex deployment.`,
      })
      continue
    }

    if (!allowed.has(target.name)) {
      refusals.push({
        code: 'CONVEX_NOT_ALLOWLISTED',
        message: `${target.label} targets "${target.name}", which is not on the allowlist. Add a non-production deployment with ${CONVEX_ALLOWLIST_ENV}.`,
      })
    }
  }

  return {
    refusals,
    deployments: [...new Set(targets.map((t) => t.name))],
    liveBackendApproved,
  }
}

/** Throw NetworkGuardError unless every check passes. */
export function assertTestnetOnly(
  input: NetworkGuardInput
): NetworkGuardResult {
  const refusals = collectNetworkGuardRefusals(input)
  if (refusals.length > 0) {
    throw new NetworkGuardError(input.operation, refusals)
  }
  const convex =
    (input.checkConvex ?? true)
      ? collectConvexRefusals(input)
      : { deployments: [], liveBackendApproved: false }
  return {
    network: 'TESTNET',
    convexDeployments: convex.deployments,
    liveBackendApproved: convex.liveBackendApproved,
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Convex runtime check: the backend may only verify and record TESTNET
 * activity. It does not need the opt-in and does not check the deployment
 * name, because the live deployment legitimately runs this code.
 */
export function assertBackendTestnet(env: EnvLike = process.env): 'TESTNET' {
  assertTestnetOnly({
    operation: 'convex backend',
    requireOptIn: false,
    checkConvex: false,
    allowUnlistedUrls: true,
    stellarNetworks: [env.STELLAR_NETWORK ?? 'TESTNET'],
    stellarUrls: [env.HORIZON_URL],
  })
  return 'TESTNET'
}

/**
 * Convex runtime check for maintenance functions (seeding, test fixtures,
 * migrations). These are deploy-kind work, so they never run on a live
 * deployment and only run on allowlisted ones.
 */
export function assertNonProductionBackend(
  operation: string,
  env: EnvLike = process.env
): void {
  if (!env.CONVEX_CLOUD_URL?.trim()) {
    throw new NetworkGuardError(operation, [
      {
        code: 'UNKNOWN_CONVEX',
        message:
          'CONVEX_CLOUD_URL is not set, so the deployment cannot be identified.',
      },
    ])
  }
  assertTestnetOnly({
    operation,
    kind: 'deploy',
    requireOptIn: false,
    stellarNetworks: [env.STELLAR_NETWORK ?? 'TESTNET'],
    stellarUrls: [env.HORIZON_URL],
    convexUrls: [env.CONVEX_CLOUD_URL],
    extraAllowedDeployments: env[CONVEX_ALLOWLIST_ENV],
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
  })
}
