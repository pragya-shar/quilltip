/**
 * Testnet-only guard.
 *
 * Scripts, deploy helpers, and operational tools call `assertTestnetOnly`
 * before they submit transactions or change a Convex deployment. The guard
 * fails closed: a missing or unknown value is a refusal, not a default.
 *
 * It applies two separate controls:
 *
 * 1. Stellar network. Only TESTNET, or LOCAL (a standalone network on this
 *    machine), is accepted. Mainnet networks, passphrases, and endpoints are
 *    refused always; nothing overrides this.
 * 2. Convex backend. Targets must be local or on an allowlist. The live
 *    backend is refused by default. An operational run (kind `operational`)
 *    may target it only when LIVE_BACKEND_APPROVAL_ENV names that deployment.
 *    Deploy-kind work (function pushes, schema pushes, imports, migrations,
 *    env changes) is refused on the live backend even with that approval.
 *    The one exception is a scheduled maintenance window: the script-side
 *    wrapper `scripts/live-window.ts` checks a window approval
 *    (scripts/lib/live-window.ts) and only then passes
 *    `liveWindowDeployment`. Nothing else sets that input.
 *
 * LOCAL mode needs the `local` opt-in, the standalone passphrase, Stellar
 * endpoints on localhost or 127.0.0.1, and a local Convex backend. It is never
 * valid with a Convex cloud deployment or with the live backend approval.
 *
 * This module has no imports outside convex/lib so Convex, Next.js, and Bun
 * scripts can share it. Client code imports it through
 * `@/lib/stellar/network-guard`; scripts use `scripts/lib/network-guard.ts`.
 */

import {
  LOCAL_PASSPHRASE,
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

/** Network modes the guard accepts. */
export type GuardedNetwork = 'TESTNET' | 'LOCAL'

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

/**
 * Env var that confirms the network mode before a guarded operation runs:
 * `testnet` for TESTNET, `local` for LOCAL.
 */
export const NETWORK_GUARD_OPT_IN_ENV = 'QUILLTIP_NETWORK_GUARD_OPT_IN'
export const NETWORK_GUARD_OPT_IN_VALUE = 'testnet'
export const NETWORK_GUARD_LOCAL_OPT_IN_VALUE = 'local'

const OPT_IN_VALUES: Record<GuardedNetwork, string> = {
  TESTNET: NETWORK_GUARD_OPT_IN_VALUE,
  LOCAL: NETWORK_GUARD_LOCAL_OPT_IN_VALUE,
}

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

/**
 * Operator approval for one scheduled maintenance window on a live backend:
 * `<deployment>@<release commit>@<UTC start>+<hours>h`. Set it per shell,
 * never in a file. Only `scripts/live-window.ts` accepts it, for a fixed list
 * of window operations; every other tool refuses to run while it is set.
 */
export const LIVE_WINDOW_APPROVAL_ENV = 'QUILLTIP_LIVE_WINDOW_APPROVAL'

const TESTNET_HOSTS = new Set([
  new URL(STELLAR_NETWORK_DEFAULTS.TESTNET.horizonUrl).hostname,
  new URL(STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl ?? '').hostname,
  'friendbot.stellar.org',
])

/** Hosts that count as a local Convex backend or local Stellar endpoint. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** LOCAL-mode Stellar endpoints must be on one of these hosts. */
const LOCAL_STELLAR_HOSTS = new Set(['localhost', '127.0.0.1'])

const KNOWN_MAINNET_HOSTS = new Set([
  new URL(STELLAR_NETWORK_DEFAULTS.MAINNET.horizonUrl).hostname,
  'mainnet.sorobanrpc.com',
  'soroban-rpc.mainnet.stellar.gateway.fm',
])

export type NetworkGuardCode =
  | 'MISSING_OPT_IN'
  | 'OPT_IN_MISMATCH'
  | 'MISSING_NETWORK'
  | 'NOT_TESTNET'
  | 'CONFLICTING_NETWORK'
  | 'MAINNET_PASSPHRASE'
  | 'UNKNOWN_PASSPHRASE'
  | 'CONFLICTING_PASSPHRASE'
  | 'MAINNET_URL'
  | 'UNTRUSTED_URL'
  | 'INVALID_URL'
  | 'LOCAL_REMOTE_URL'
  | 'LOCAL_CLOUD_CONVEX'
  | 'LOCAL_LIVE_APPROVAL'
  | 'CLI_NETWORK_FLAG'
  | 'PROD_CONVEX_TYPE'
  | 'UNKNOWN_CONVEX'
  | 'CONVEX_NOT_ALLOWLISTED'
  | 'LIVE_BACKEND_NOT_APPROVED'
  | 'LIVE_BACKEND_DEPLOY'
  | 'LIVE_IN_ALLOWLIST'
  | 'APPROVAL_NOT_FOR_DEPLOY'
  | 'INVALID_APPROVAL'
  | 'CONVEX_KEY_FOR_STELLAR_ONLY'
  | 'LIVE_WINDOW_INVALID'
  | 'LIVE_WINDOW_NOT_STARTED'
  | 'LIVE_WINDOW_EXPIRED'
  | 'LIVE_WINDOW_COMMIT'
  | 'LIVE_WINDOW_DIRTY'
  | 'LIVE_WINDOW_IN_FILE'
  | 'LIVE_WINDOW_OPERATION'
  | 'LIVE_WINDOW_OTHER_TARGET'
  | 'LIVE_WINDOW_CREDENTIAL'
  | 'LIVE_WINDOW_NOT_FOR_TOOL'
  | 'LIVE_WINDOW_LOG'

export type NetworkGuardRefusal = {
  code: NetworkGuardCode
  message: string
}

export class NetworkGuardError extends Error {
  readonly refusals: NetworkGuardRefusal[]

  constructor(operation: string, refusals: NetworkGuardRefusal[]) {
    super(
      [
        `Network guard refused "${operation}". Guarded tools run on Stellar TESTNET (or a local standalone network) and allowlisted Convex deployments only.`,
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
  /** Stellar network values from every source in use; all must agree. */
  stellarNetworks?: Array<string | null | undefined>
  /** Single passphrase value. Kept for earlier callers; merged with the list. */
  networkPassphrase?: string | null
  /** Passphrase values from every source in use; all must agree. */
  networkPassphrases?: Array<string | null | undefined>
  /** Horizon, RPC, or friendbot URLs the operation will contact. */
  stellarUrls?: Array<string | null | undefined>
  /** Convex URLs (`https://<name>.convex.cloud`, `.convex.site`, or local). */
  convexUrls?: Array<string | null | undefined>
  /** `CONVEX_DEPLOYMENT` value (`dev:name`, `prod:name`, `local:name`, `name`). */
  convexDeployment?: string | null
  /** `CONVEX_DEPLOY_KEY` value. Only its type prefix and name are read. */
  convexDeployKey?: string | null
  /** CONVEX_DEPLOYMENT_TOKEN, which the Convex CLI also reads as a deploy key. */
  convexDeploymentToken?: string | null
  /** Value of QUILLTIP_NETWORK_GUARD_OPT_IN. */
  optIn?: string | null
  /** Value of QUILLTIP_CONVEX_ALLOWLIST. */
  extraAllowedDeployments?: string | null
  /** Value of QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS. */
  extraProductionDeployments?: string | null
  /** Value of QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL. */
  liveBackendApproval?: string | null
  /**
   * Live deployment opened for one deploy-kind run in a scheduled maintenance
   * window. Only `scripts/lib/live-window.ts` sets it, after it has checked
   * the window approval (deployment, release commit, clean checkout, expiry
   * and operation). It never applies to operational runs, LOCAL mode, a
   * `prod:` deployment type or any other deployment, and it never relaxes the
   * Stellar checks.
   */
  liveWindowDeployment?: string | null
  /** Set false to skip Stellar checks for Convex-only tools. */
  checkStellar?: boolean
  /** Set false to skip Convex checks (backend network check only). */
  checkConvex?: boolean
  /** Set false to skip the opt-in check (backend runtime checks only). */
  requireOptIn?: boolean
  /**
   * Accept TESTNET-mode Stellar URLs on hosts outside the testnet allowlist
   * (mainnet hosts are still refused). Only the backend and client runtime
   * checks use this, so a custom testnet provider keeps working on deployed
   * backends. It never applies in LOCAL mode.
   */
  allowUnlistedUrls?: boolean
}

export type NetworkGuardResult = {
  network: GuardedNetwork
  convexDeployments: string[]
  /** True when an approved operational run targets a live backend. */
  liveBackendApproved: boolean
  /** True when a maintenance-window deploy run targets a live backend. */
  liveWindowApproved?: boolean
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

/** Lower-case host without IPv6 brackets or trailing dots. */
function normalizedHost(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.+$/, '')
}

/** True for a URL on a local host (localhost, 127.0.0.1, ::1). */
export function isLocalUrl(url: string | null | undefined): boolean {
  if (!present(url)) return false
  try {
    return LOCAL_HOSTS.has(new URL(url.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
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

/** Passphrase form used to detect mainnet in any casing or spacing. */
function loosePassphrase(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function checkStellarUrl(
  url: string,
  mode: GuardedNetwork | null,
  allowUnlistedUrls: boolean
): NetworkGuardRefusal | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { code: 'INVALID_URL', message: `"${url}" is not a valid URL.` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      code: 'INVALID_URL',
      message: `"${parsed.protocol}" is not an HTTP(S) endpoint.`,
    }
  }
  const host = normalizedHost(parsed)
  if (KNOWN_MAINNET_HOSTS.has(host) || /(^|[.-])mainnet([.-]|$)/.test(host)) {
    return {
      code: 'MAINNET_URL',
      message: `${parsed.origin} is a Stellar mainnet endpoint.`,
    }
  }
  const exactHost = parsed.hostname.toLowerCase()
  if (mode === 'LOCAL') {
    if (LOCAL_STELLAR_HOSTS.has(exactHost)) return null
    return {
      code: 'LOCAL_REMOTE_URL',
      message: `${parsed.origin} is not on localhost or 127.0.0.1. LOCAL mode uses local endpoints only.`,
    }
  }
  if (TESTNET_HOSTS.has(exactHost) || LOCAL_HOSTS.has(exactHost)) return null
  if (allowUnlistedUrls) return null
  return {
    code: 'UNTRUSTED_URL',
    message: `${parsed.origin} is not a known testnet or local endpoint.`,
  }
}

/**
 * Network mode from the network values (Stellar checks on) or from the
 * opt-in (Convex-only checks). Null when the values do not name one mode.
 */
function guardMode(input: NetworkGuardInput): GuardedNetwork | null {
  if (input.checkStellar ?? true) {
    const distinct = new Set(
      (input.stellarNetworks ?? []).filter(present).map((n) => n.trim())
    )
    if (distinct.size !== 1) return null
    const [network] = [...distinct]
    return network === 'TESTNET' || network === 'LOCAL' ? network : null
  }
  const optIn = input.optIn?.trim()
  if (optIn === NETWORK_GUARD_LOCAL_OPT_IN_VALUE) return 'LOCAL'
  if (optIn === NETWORK_GUARD_OPT_IN_VALUE) return 'TESTNET'
  return null
}

type Evaluation = {
  refusals: NetworkGuardRefusal[]
  mode: GuardedNetwork | null
  deployments: string[]
  liveBackendApproved: boolean
  liveWindowApproved: boolean
}

/**
 * Collect every reason the operation must not run. Returns an empty list when
 * the inputs describe TESTNET (or LOCAL) and a permitted Convex target.
 */
export function collectNetworkGuardRefusals(
  input: NetworkGuardInput
): NetworkGuardRefusal[] {
  return evaluate(input).refusals
}

function evaluate(input: NetworkGuardInput): Evaluation {
  const refusals: NetworkGuardRefusal[] = []
  const mode = guardMode(input)

  if (input.requireOptIn ?? true) {
    const optIn = input.optIn?.trim() ?? ''
    const expected = OPT_IN_VALUES[mode ?? 'TESTNET']
    if (optIn === '') {
      refusals.push({
        code: 'MISSING_OPT_IN',
        message: `Set ${NETWORK_GUARD_OPT_IN_ENV}=${expected} to confirm the network this run targets.`,
      })
    } else if (optIn !== expected) {
      refusals.push({
        code: 'OPT_IN_MISMATCH',
        message: `${NETWORK_GUARD_OPT_IN_ENV} is "${optIn}", but this run needs "${expected}"${mode ? ` for ${mode}` : ''}.`,
      })
    }
  }

  if (input.checkStellar ?? true) {
    refusals.push(...collectStellarRefusals(input, mode))
  }

  if (!(input.checkConvex ?? true)) {
    return {
      refusals,
      mode,
      deployments: [],
      liveBackendApproved: false,
      liveWindowApproved: false,
    }
  }
  const convex = collectConvexRefusals(input, mode)
  return {
    refusals: [...refusals, ...convex.refusals],
    mode,
    deployments: convex.deployments,
    liveBackendApproved: convex.liveBackendApproved,
    liveWindowApproved: convex.liveWindowApproved,
  }
}

function collectStellarRefusals(
  input: NetworkGuardInput,
  mode: GuardedNetwork | null
): NetworkGuardRefusal[] {
  const refusals: NetworkGuardRefusal[] = []
  const networks = new Set(
    (input.stellarNetworks ?? []).filter(present).map((n) => n.trim())
  )
  if (networks.size === 0) {
    refusals.push({
      code: 'MISSING_NETWORK',
      message:
        'No Stellar network is set. Set NEXT_PUBLIC_STELLAR_NETWORK=TESTNET (scripts) or STELLAR_NETWORK=TESTNET (Convex).',
    })
  } else if (networks.size > 1) {
    refusals.push({
      code: 'CONFLICTING_NETWORK',
      message: `Stellar network values disagree: ${[...networks].join(', ')}.`,
    })
  }
  for (const network of networks) {
    if (network !== 'TESTNET' && network !== 'LOCAL') {
      refusals.push({
        code: 'NOT_TESTNET',
        message: `Stellar network is "${network}"; only TESTNET (or LOCAL for a local standalone network) is allowed.`,
      })
    }
  }

  const passphrases = new Set(
    [input.networkPassphrase, ...(input.networkPassphrases ?? [])]
      .filter(present)
      .map((p) => p.trim())
  )
  if (passphrases.size > 1) {
    refusals.push({
      code: 'CONFLICTING_PASSPHRASE',
      message: 'Network passphrase values disagree.',
    })
  }
  const expected = mode === 'LOCAL' ? LOCAL_PASSPHRASE : TESTNET_PASSPHRASE
  for (const passphrase of passphrases) {
    if (loosePassphrase(passphrase) === loosePassphrase(MAINNET_PASSPHRASE)) {
      refusals.push({
        code: 'MAINNET_PASSPHRASE',
        message: 'The network passphrase is the Stellar mainnet passphrase.',
      })
    } else if (passphrase !== expected) {
      refusals.push({
        code: 'UNKNOWN_PASSPHRASE',
        message: `The network passphrase is not "${expected}"${mode ? ` (${mode})` : ''}.`,
      })
    }
  }

  for (const url of (input.stellarUrls ?? []).filter(present)) {
    const refusal = checkStellarUrl(
      url.trim(),
      mode,
      input.allowUnlistedUrls ?? false
    )
    if (refusal) refusals.push(refusal)
  }
  return refusals
}

type ConvexTarget = { label: string; type: string | null; name: string }

function collectConvexRefusals(
  input: NetworkGuardInput,
  mode: GuardedNetwork | null
): {
  refusals: NetworkGuardRefusal[]
  deployments: string[]
  liveBackendApproved: boolean
  liveWindowApproved: boolean
} {
  const refusals: NetworkGuardRefusal[] = []
  const kind = input.kind ?? 'deploy'
  const local = mode === 'LOCAL'
  const live = productionDeploymentDenylist(input.extraProductionDeployments)
  const extraAllowed = nameList(input.extraAllowedDeployments)
  const allowed = nameList(ALLOWED_CONVEX_DEPLOYMENTS)
  const approval = input.liveBackendApproval?.trim().toLowerCase() ?? ''
  const windowDeployment =
    input.liveWindowDeployment?.trim().toLowerCase() ?? ''

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
    if (local) {
      refusals.push({
        code: 'LOCAL_LIVE_APPROVAL',
        message: `${LIVE_BACKEND_APPROVAL_ENV} is set. LOCAL mode runs against a local backend only. Unset it.`,
      })
    }
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

  if (windowDeployment) {
    if (local) {
      refusals.push({
        code: 'LOCAL_LIVE_APPROVAL',
        message:
          'A maintenance-window approval is set. LOCAL mode runs against a local backend only.',
      })
    }
    if (kind !== 'deploy') {
      refusals.push({
        code: 'LIVE_WINDOW_NOT_FOR_TOOL',
        message:
          'A maintenance-window approval applies to the listed deploy-kind window operations only, never to operational runs.',
      })
    }
    if (!live.has(windowDeployment)) {
      refusals.push({
        code: 'LIVE_WINDOW_INVALID',
        message: `The maintenance-window approval names "${windowDeployment}", which is not a live deployment.`,
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
      refusals.push(
        local
          ? {
              code: 'LOCAL_CLOUD_CONVEX',
              message: `${host} is not a local Convex backend. LOCAL mode needs a local backend.`,
            }
          : {
              code: 'CONVEX_NOT_ALLOWLISTED',
              message: `${host} is not a Convex deployment URL on the allowlist.`,
            }
      )
      continue
    }
    targets.push({ label: 'Convex URL', type: null, name })
  }

  // The Convex CLI reads CONVEX_DEPLOYMENT_TOKEN as a deploy key too, and a
  // deploy key takes precedence over CONVEX_DEPLOYMENT.
  for (const [label, value] of [
    ['CONVEX_DEPLOYMENT', input.convexDeployment],
    ['CONVEX_DEPLOY_KEY', input.convexDeployKey],
    ['CONVEX_DEPLOYMENT_TOKEN', input.convexDeploymentToken],
  ] as const) {
    if (!present(value)) continue
    if (label !== 'CONVEX_DEPLOYMENT' && !value.includes('|')) {
      // Without the `type:name|` prefix the whole value is secret material;
      // refuse without echoing it.
      refusals.push({
        code: 'CONVEX_NOT_ALLOWLISTED',
        message: `${label} does not name its deployment (expected "type:name|..."), so its target cannot be checked.`,
      })
      continue
    }
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
      message: local
        ? 'No Convex backend is selected. LOCAL mode needs a local backend (CONVEX_DEPLOYMENT=local:... or a 127.0.0.1 URL).'
        : 'No Convex deployment is selected. Set CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to an allowlisted deployment.',
    })
  }

  if (windowDeployment && hasLocalTarget) {
    refusals.push({
      code: 'LIVE_WINDOW_OTHER_TARGET',
      message:
        'A local Convex target is set together with a maintenance-window approval. Clear every other target.',
    })
  }

  let liveBackendApproved = false
  let liveWindowApproved = false
  const seen = new Set<string>()
  for (const target of targets) {
    const key = `${target.label}:${target.name}`
    if (seen.has(key)) continue
    seen.add(key)

    if (local) {
      refusals.push({
        code: 'LOCAL_CLOUD_CONVEX',
        message: `${target.label} targets Convex cloud deployment "${target.name}". LOCAL mode is never valid for a cloud deployment.`,
      })
    }

    if (windowDeployment && target.name !== windowDeployment) {
      refusals.push({
        code: 'LIVE_WINDOW_OTHER_TARGET',
        message: `${target.label} targets "${target.name}", but the maintenance-window approval names "${windowDeployment}". Clear every other target.`,
      })
      continue
    }

    if (live.has(target.name)) {
      if (windowDeployment && target.type === 'prod') {
        // A production-type deployment is never opened, not even in a window.
        refusals.push({
          code: 'PROD_CONVEX_TYPE',
          message: `${target.label} selects a production-type Convex deployment.`,
        })
      }
      if (
        kind === 'deploy' &&
        windowDeployment === target.name &&
        !local &&
        target.type !== 'prod'
      ) {
        liveWindowApproved = true
      } else if (kind === 'deploy') {
        refusals.push({
          code: 'LIVE_BACKEND_DEPLOY',
          message: `${target.label} targets live deployment "${target.name}". Deploys, schema pushes, imports, and migrations from developer tooling are never allowed there.`,
        })
      } else if (approval === target.name && !local) {
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
    liveWindowApproved,
  }
}

/** Throw NetworkGuardError unless every check passes. */
export function assertTestnetOnly(
  input: NetworkGuardInput
): NetworkGuardResult {
  const result = evaluate(input)
  if (result.refusals.length > 0) {
    throw new NetworkGuardError(input.operation, result.refusals)
  }
  return {
    // A passing run always has a mode, except Convex-only checks without the
    // opt-in requirement, which only run on TESTNET backends.
    network: result.mode ?? 'TESTNET',
    convexDeployments: result.deployments,
    liveBackendApproved: result.liveBackendApproved,
    ...(result.liveWindowApproved ? { liveWindowApproved: true } : {}),
  }
}

type EnvLike = Record<string, string | undefined>

function localConvexRefusal(
  label: string,
  url: string | undefined
): NetworkGuardRefusal | null {
  if (!present(url)) {
    return {
      code: 'UNKNOWN_CONVEX',
      message: `${label} is not set, so a local backend cannot be confirmed. LOCAL mode needs a local Convex backend.`,
    }
  }
  if (isLocalUrl(url)) return null
  return {
    code: 'LOCAL_CLOUD_CONVEX',
    message: `${label} is not a local backend. LOCAL mode is never valid for a Convex cloud deployment.`,
  }
}

/**
 * Convex runtime check for the network setting. TESTNET needs no opt-in and
 * does not check the deployment name, because the live deployment runs this
 * code. LOCAL needs `QUILLTIP_NETWORK_GUARD_OPT_IN=local`, the standalone
 * passphrase, local endpoints, and a local backend (`CONVEX_CLOUD_URL`).
 * Checks STELLAR_NETWORK, NETWORK_PASSPHRASE, STELLAR_RPC_URL, and HORIZON_URL.
 */
export function assertBackendNetwork(
  env: EnvLike = process.env
): GuardedNetwork {
  const network = env.STELLAR_NETWORK ?? 'TESTNET'
  const result = assertTestnetOnly({
    operation: 'convex backend',
    requireOptIn: network.trim() === 'LOCAL',
    optIn: env[NETWORK_GUARD_OPT_IN_ENV],
    checkConvex: false,
    allowUnlistedUrls: true,
    stellarNetworks: [network],
    networkPassphrases: [env.NETWORK_PASSPHRASE],
    stellarUrls: [env.HORIZON_URL, env.STELLAR_RPC_URL],
  })
  if (result.network === 'LOCAL') {
    const refusal = localConvexRefusal('CONVEX_CLOUD_URL', env.CONVEX_CLOUD_URL)
    if (refusal) throw new NetworkGuardError('convex backend', [refusal])
  }
  return result.network
}

/**
 * Convex runtime check for TESTNET payment flows: the backend may only verify
 * and record TESTNET activity. Runs `assertBackendNetwork()` and also refuses
 * LOCAL; code that supports LOCAL calls `assertBackendNetwork()` instead.
 */
export function assertBackendTestnet(env: EnvLike = process.env): 'TESTNET' {
  if (assertBackendNetwork(env) !== 'TESTNET') {
    throw new NetworkGuardError('convex backend', [
      {
        code: 'NOT_TESTNET',
        message:
          'STELLAR_NETWORK is LOCAL. This flow records TESTNET activity only.',
      },
    ])
  }
  return 'TESTNET'
}

/**
 * Backend check for the network stored on a tip row before it is verified.
 * Rows without a network predate the field and were recorded on TESTNET.
 * Returns the Horizon URL to use: the HORIZON_URL override when
 * `allowOverride` is true, otherwise the TESTNET default.
 */
export function backendVerificationHorizonUrl(
  recordedNetwork: string | null | undefined,
  options: { allowOverride: boolean },
  env: EnvLike = process.env
): string {
  assertBackendTestnet(env)
  const recorded = recordedNetwork ?? 'TESTNET'
  if (recorded.trim() !== 'TESTNET') {
    throw new NetworkGuardError('tip verification', [
      {
        code: 'NOT_TESTNET',
        message: `The tip was recorded on "${recorded}"; only TESTNET rows are verified.`,
      },
    ])
  }
  const override = env.HORIZON_URL?.trim()
  return options.allowOverride && override
    ? override
    : STELLAR_NETWORK_DEFAULTS.TESTNET.horizonUrl
}

export type ClientNetworkConfig = {
  network: string
  passphrase: string
  horizonUrl: string
  rpcUrl: string
  /** NEXT_PUBLIC_CONVEX_URL. Required for LOCAL, which needs a local backend. */
  convexUrl?: string
}

/**
 * Client check: the browser app signs and submits TESTNET transactions, or
 * LOCAL ones against a local standalone network and a local Convex backend.
 * A MAINNET setting, a mainnet passphrase, or a mainnet endpoint fails at
 * load, before any wallet or network call.
 */
export function assertClientNetwork(
  config: ClientNetworkConfig
): GuardedNetwork {
  const result = assertTestnetOnly({
    operation: 'client Stellar configuration',
    requireOptIn: false,
    checkConvex: false,
    allowUnlistedUrls: true,
    stellarNetworks: [config.network],
    networkPassphrase: config.passphrase,
    stellarUrls: [config.horizonUrl, config.rpcUrl],
  })
  if (result.network === 'LOCAL') {
    const refusal = localConvexRefusal(
      'NEXT_PUBLIC_CONVEX_URL',
      config.convexUrl
    )
    if (refusal) {
      throw new NetworkGuardError('client Stellar configuration', [refusal])
    }
  }
  return result.network
}

/** TESTNET-only form of `assertClientNetwork`. */
export function assertClientTestnet(config: ClientNetworkConfig): 'TESTNET' {
  if (assertClientNetwork(config) !== 'TESTNET') {
    throw new NetworkGuardError('client Stellar configuration', [
      { code: 'NOT_TESTNET', message: 'Only TESTNET is accepted here.' },
    ])
  }
  return 'TESTNET'
}

/**
 * Convex runtime check for maintenance functions (seeding, test fixtures,
 * migrations). These are deploy-kind work, so they never run on a live
 * deployment and only run on allowlisted or local ones.
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
  const network = env.STELLAR_NETWORK ?? 'TESTNET'
  assertTestnetOnly({
    operation,
    kind: 'deploy',
    requireOptIn: network.trim() === 'LOCAL',
    optIn: env[NETWORK_GUARD_OPT_IN_ENV],
    stellarNetworks: [network],
    networkPassphrases: [env.NETWORK_PASSPHRASE],
    stellarUrls: [env.HORIZON_URL, env.STELLAR_RPC_URL],
    convexUrls: [env.CONVEX_CLOUD_URL],
    extraAllowedDeployments: env[CONVEX_ALLOWLIST_ENV],
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
  })
}
