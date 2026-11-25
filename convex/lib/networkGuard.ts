/**
 * Testnet-only guard.
 *
 * Scripts, deploy helpers, and operational tools call `assertTestnetOnly`
 * before they submit transactions or change a Convex deployment. The guard
 * fails closed: a missing or unknown value is a refusal, not a default.
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

/** Convex deployments that serve live users. Never target these. */
export const PRODUCTION_CONVEX_DEPLOYMENTS: readonly string[] = [
  'upbeat-mockingbird-579',
]

/** Env var that must equal OPT_IN_VALUE before a guarded operation runs. */
export const NETWORK_GUARD_OPT_IN_ENV = 'QUILLTIP_NETWORK_GUARD_OPT_IN'
export const NETWORK_GUARD_OPT_IN_VALUE = 'testnet'

/** Optional comma-separated list that adds to PRODUCTION_CONVEX_DEPLOYMENTS. */
export const EXTRA_PRODUCTION_DEPLOYMENTS_ENV =
  'QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS'

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
  | 'PRODUCTION_CONVEX'
  | 'PROD_CONVEX_TYPE'
  | 'UNKNOWN_CONVEX'

export type NetworkGuardRefusal = {
  code: NetworkGuardCode
  message: string
}

export class NetworkGuardError extends Error {
  readonly refusals: NetworkGuardRefusal[]

  constructor(operation: string, refusals: NetworkGuardRefusal[]) {
    super(
      [
        `Network guard refused "${operation}". This tool runs on Stellar TESTNET and non-production Convex deployments only.`,
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
  /** Stellar network values from every source in use; all must be TESTNET. */
  stellarNetworks?: Array<string | null | undefined>
  networkPassphrase?: string | null
  /** Horizon, RPC, or friendbot URLs the operation will contact. */
  stellarUrls?: Array<string | null | undefined>
  /** Convex URLs (`https://<name>.convex.cloud`, `.convex.site`). */
  convexUrls?: Array<string | null | undefined>
  /** `CONVEX_DEPLOYMENT` value (`dev:name`, `prod:name`, or `name`). */
  convexDeployment?: string | null
  /** `CONVEX_DEPLOY_KEY` value. Only its `prod:`/`dev:` prefix and name are read. */
  convexDeployKey?: string | null
  /** Value of QUILLTIP_NETWORK_GUARD_OPT_IN. */
  optIn?: string | null
  /** Extra production deployment names (from env). */
  extraProductionDeployments?: string | null
  /** Set false to skip Stellar checks for Convex-only tools. */
  checkStellar?: boolean
  /** Set false to skip the opt-in check (backend runtime checks only). */
  requireOptIn?: boolean
  /**
   * Accept Stellar URLs on hosts outside the testnet allowlist (mainnet hosts
   * are still refused). Only the backend runtime check uses this, so a custom
   * testnet Horizon provider keeps working on deployed backends.
   */
  allowUnlistedUrls?: boolean
  /** Refuse when no Convex URL or deployment is given (Convex-changing tools). */
  requireConvexTarget?: boolean
}

export type NetworkGuardResult = {
  network: 'TESTNET'
  convexDeployments: string[]
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function productionDeploymentDenylist(
  extra?: string | null
): Set<string> {
  const names = new Set(PRODUCTION_CONVEX_DEPLOYMENTS)
  for (const name of (extra ?? '').split(',')) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) names.add(trimmed)
  }
  return names
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

  const denylist = productionDeploymentDenylist(
    input.extraProductionDeployments
  )

  if (
    input.requireConvexTarget &&
    !(input.convexUrls ?? []).some(present) &&
    !present(input.convexDeployment) &&
    !present(input.convexDeployKey)
  ) {
    refusals.push({
      code: 'UNKNOWN_CONVEX',
      message:
        'No Convex deployment is selected. Set CONVEX_DEPLOYMENT to a non-production deployment.',
    })
  }

  for (const url of (input.convexUrls ?? []).filter(present)) {
    const name = convexDeploymentNameFromUrl(url.trim())
    if (name && denylist.has(name)) {
      refusals.push({
        code: 'PRODUCTION_CONVEX',
        message: `Convex URL targets production deployment "${name}".`,
      })
    }
  }

  for (const [label, value] of [
    ['CONVEX_DEPLOYMENT', input.convexDeployment],
    ['CONVEX_DEPLOY_KEY', input.convexDeployKey],
  ] as const) {
    if (!present(value)) continue
    const { type, name } = parseConvexDeploymentRef(value)
    if (type === 'prod') {
      refusals.push({
        code: 'PROD_CONVEX_TYPE',
        message: `${label} selects a production-type Convex deployment.`,
      })
    }
    if (name && denylist.has(name)) {
      refusals.push({
        code: 'PRODUCTION_CONVEX',
        message: `${label} targets production deployment "${name}".`,
      })
    }
  }

  return refusals
}

/** Throw NetworkGuardError unless every check passes. */
export function assertTestnetOnly(
  input: NetworkGuardInput
): NetworkGuardResult {
  const refusals = collectNetworkGuardRefusals(input)
  if (refusals.length > 0) {
    throw new NetworkGuardError(input.operation, refusals)
  }
  const deployments = new Set<string>()
  for (const url of (input.convexUrls ?? []).filter(present)) {
    const name = convexDeploymentNameFromUrl(url)
    if (name) deployments.add(name)
  }
  if (present(input.convexDeployment)) {
    deployments.add(parseConvexDeploymentRef(input.convexDeployment).name)
  }
  return { network: 'TESTNET', convexDeployments: [...deployments] }
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
    allowUnlistedUrls: true,
    stellarNetworks: [env.STELLAR_NETWORK ?? 'TESTNET'],
    stellarUrls: [env.HORIZON_URL],
  })
  return 'TESTNET'
}

/**
 * Convex runtime check for operational functions (seeding, test fixtures,
 * maintenance). Refuses to run on a production deployment.
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
    requireOptIn: false,
    stellarNetworks: [env.STELLAR_NETWORK ?? 'TESTNET'],
    stellarUrls: [env.HORIZON_URL],
    convexUrls: [env.CONVEX_CLOUD_URL, env.CONVEX_SITE_URL],
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
  })
}
