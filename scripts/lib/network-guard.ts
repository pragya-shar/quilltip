/**
 * Script-side entry point for the testnet-only guard.
 *
 * Every script, deploy helper, and operational tool that submits Stellar
 * transactions or changes a Convex deployment must call one of these
 * functions before it does any work. See docs/SETUP.md ("Testnet guard").
 */
import {
  CONVEX_ALLOWLIST_ENV,
  EXTRA_PRODUCTION_DEPLOYMENTS_ENV,
  LIVE_BACKEND_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertTestnetOnly,
  type NetworkGuardRefusal,
  type NetworkGuardResult,
} from '../../convex/lib/networkGuard'
import {
  pickRpcUrl,
  resolveStellarNetwork,
  type ResolvedStellarNetwork,
} from '../../convex/lib/stellarNetwork'

export { NetworkGuardError }

type EnvLike = Record<string, string | undefined>

function convexInputs(env: EnvLike) {
  return {
    optIn: env[NETWORK_GUARD_OPT_IN_ENV],
    convexUrls: [
      env.NEXT_PUBLIC_CONVEX_URL,
      env.CONVEX_URL,
      env.CONVEX_SELF_HOSTED_URL,
    ],
    convexDeployment: env.CONVEX_DEPLOYMENT,
    convexDeployKey: env.CONVEX_DEPLOY_KEY,
    extraAllowedDeployments: env[CONVEX_ALLOWLIST_ENV],
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
    liveBackendApproval: env[LIVE_BACKEND_APPROVAL_ENV],
  }
}

/** RPC URL variables, most specific first. */
export const SCRIPT_RPC_URL_VARIABLES = [
  'STELLAR_RPC_URL',
  'NEXT_PUBLIC_STELLAR_RPC_URL',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
] as const

/** Network passphrase variables. All set values must agree. */
export const SCRIPT_PASSPHRASE_VARIABLES = [
  'NETWORK_PASSPHRASE',
  'NEXT_PUBLIC_NETWORK_PASSPHRASE',
] as const

function stellarInputs(env: EnvLike) {
  return {
    stellarNetworks: [env.NEXT_PUBLIC_STELLAR_NETWORK, env.STELLAR_NETWORK],
    networkPassphrases: SCRIPT_PASSPHRASE_VARIABLES.map((name) => env[name]),
    stellarUrls: [
      ...SCRIPT_RPC_URL_VARIABLES.map((name) => env[name]),
      env.NEXT_PUBLIC_HORIZON_URL,
      env.HORIZON_URL,
    ],
  }
}

/**
 * Operational runs that submit testnet transactions or record test activity.
 * Refuses unless the environment targets Stellar TESTNET (or LOCAL), carries
 * the matching opt-in, and targets an allowlisted (or local) Convex backend.
 * A live backend is accepted only with QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL
 * naming it, and never in LOCAL mode.
 */
export function assertScriptTestnetOnly(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  return assertTestnetOnly({
    operation,
    kind: 'operational',
    ...convexInputs(env),
    ...stellarInputs(env),
  })
}

export type ScriptStellarNetwork = ResolvedStellarNetwork & {
  guard: NetworkGuardResult
}

/**
 * Run the operational guard, then resolve the network, RPC URL, passphrase,
 * and Horizon URL the script must use. Scripts pass these values on
 * explicitly and never rely on tool defaults.
 */
export function resolveScriptStellarNetwork(
  operation: string,
  env: EnvLike = process.env
): ScriptStellarNetwork {
  const guard = assertScriptTestnetOnly(operation, env)
  return resolveWithGuard(guard, env)
}

function resolveWithGuard(
  guard: NetworkGuardResult,
  env: EnvLike
): ScriptStellarNetwork {
  // Check the two public names agree even when STELLAR_RPC_URL takes effect.
  const publicRpcUrl = pickRpcUrl(
    env.NEXT_PUBLIC_STELLAR_RPC_URL,
    env.NEXT_PUBLIC_SOROBAN_RPC_URL
  )
  const rpcUrl = env.STELLAR_RPC_URL?.trim() || publicRpcUrl
  const passphrase = SCRIPT_PASSPHRASE_VARIABLES.map((name) =>
    env[name]?.trim()
  ).find(Boolean)
  const resolved = resolveStellarNetwork({
    network: guard.network,
    passphrase,
    rpcUrl,
    horizonUrl: env.HORIZON_URL?.trim() || env.NEXT_PUBLIC_HORIZON_URL,
  })
  return { ...resolved, guard }
}

/**
 * Stellar-only variant for scripts that touch no Convex backend (contract
 * deploy, extend, restore, redeploy). It applies the opt-in, network,
 * passphrase and endpoint checks, including the LOCAL rules, and so always
 * refuses mainnet. It needs no Convex target, and it refuses to run while a
 * Convex deploy key or a live-backend approval is set, so it cannot stand in
 * for the Convex checks of `assertScriptTestnetOnly`
 * (docs/architecture/v2/06-app-integration.md, section 6.8).
 */
export function assertScriptStellarTestnetOnly(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  const refusals: NetworkGuardRefusal[] = []
  if (env.CONVEX_DEPLOY_KEY?.trim()) {
    refusals.push({
      code: 'CONVEX_KEY_FOR_STELLAR_ONLY',
      message:
        'CONVEX_DEPLOY_KEY is set. Stellar-only tools never use a Convex deploy key; unset it for this run.',
    })
  }
  if (env[LIVE_BACKEND_APPROVAL_ENV]?.trim()) {
    refusals.push({
      code: 'APPROVAL_NOT_FOR_DEPLOY',
      message: `${LIVE_BACKEND_APPROVAL_ENV} does not apply to Stellar-only tools. Unset it.`,
    })
  }
  let result: NetworkGuardResult | null = null
  try {
    result = assertTestnetOnly({
      operation,
      kind: 'operational',
      optIn: env[NETWORK_GUARD_OPT_IN_ENV],
      checkConvex: false,
      ...stellarInputs(env),
    })
  } catch (error) {
    if (!(error instanceof NetworkGuardError)) throw error
    refusals.push(...error.refusals)
  }
  if (refusals.length > 0 || !result) {
    throw new NetworkGuardError(operation, refusals)
  }
  return result
}

/**
 * `assertScriptStellarTestnetOnly`, then the network, RPC URL, passphrase and
 * Horizon URL the script must pass on explicitly.
 */
export function resolveScriptStellarOnlyNetwork(
  operation: string,
  env: EnvLike = process.env
): ScriptStellarNetwork {
  const guard = assertScriptStellarTestnetOnly(operation, env)
  return resolveWithGuard(guard, env)
}

/**
 * Deploy-kind tools: function or schema pushes (`convex dev`), imports,
 * migrations, and env changes. Never allowed on a live backend, and the live
 * backend approval variable must not be set.
 */
export function assertScriptConvexDeployAllowed(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  // The Convex CLI chooses its target from these values, not from
  // NEXT_PUBLIC_CONVEX_URL, so one of them must name the checked deployment.
  const cliTargets = [
    env.CONVEX_DEPLOYMENT,
    env.CONVEX_DEPLOY_KEY,
    env.CONVEX_SELF_HOSTED_URL,
  ]
  if (!cliTargets.some((value) => value?.trim())) {
    throw new NetworkGuardError(operation, [
      {
        code: 'UNKNOWN_CONVEX',
        message:
          'No Convex CLI target is set. Set CONVEX_DEPLOYMENT (or CONVEX_SELF_HOSTED_URL for a local backend) to an allowlisted deployment.',
      },
    ])
  }
  return assertTestnetOnly({
    operation,
    kind: 'deploy',
    checkStellar: false,
    ...convexInputs(env),
  })
}

const LOCAL_URL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Browser test runs must target a local app server. Test suites that sign in
 * or write data never run against a deployed site.
 */
export function assertLocalBaseUrl(
  operation: string,
  url: string | undefined
): void {
  let host = ''
  try {
    host = url ? new URL(url).hostname.toLowerCase() : ''
  } catch {
    host = ''
  }
  if (!LOCAL_URL_HOSTS.has(host)) {
    throw new NetworkGuardError(operation, [
      {
        code: 'UNTRUSTED_URL',
        message: `Base URL "${url ?? ''}" is not a local app server (localhost or 127.0.0.1).`,
      },
    ])
  }
}
