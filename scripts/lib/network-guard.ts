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
  type NetworkGuardResult,
} from '../../convex/lib/networkGuard'

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

/**
 * Operational runs that submit testnet transactions or record test activity.
 * Refuses unless the environment targets Stellar TESTNET, carries the opt-in,
 * and targets an allowlisted (or local) Convex backend. A live backend is
 * accepted only with QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL naming it.
 */
export function assertScriptTestnetOnly(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  return assertTestnetOnly({
    operation,
    kind: 'operational',
    ...convexInputs(env),
    stellarNetworks: [env.NEXT_PUBLIC_STELLAR_NETWORK, env.STELLAR_NETWORK],
    networkPassphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    stellarUrls: [
      env.NEXT_PUBLIC_HORIZON_URL,
      env.NEXT_PUBLIC_SOROBAN_RPC_URL,
      env.HORIZON_URL,
    ],
  })
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
  return assertTestnetOnly({
    operation,
    kind: 'deploy',
    checkStellar: false,
    ...convexInputs(env),
  })
}
