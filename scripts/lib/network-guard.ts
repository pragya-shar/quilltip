/**
 * Script-side entry point for the testnet-only guard.
 *
 * Every script, deploy helper, and operational tool that submits Stellar
 * transactions or changes a Convex deployment must call one of these
 * functions before it does any work. See docs/SETUP.md ("Testnet guard").
 */
import {
  EXTRA_PRODUCTION_DEPLOYMENTS_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertTestnetOnly,
  type NetworkGuardResult,
} from '../../convex/lib/networkGuard'

export { NetworkGuardError }

type EnvLike = Record<string, string | undefined>

/**
 * Refuse unless the environment targets Stellar TESTNET, a non-production
 * Convex deployment, and carries the explicit opt-in.
 */
export function assertScriptTestnetOnly(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  return assertTestnetOnly({
    operation,
    optIn: env[NETWORK_GUARD_OPT_IN_ENV],
    stellarNetworks: [env.NEXT_PUBLIC_STELLAR_NETWORK, env.STELLAR_NETWORK],
    networkPassphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    stellarUrls: [
      env.NEXT_PUBLIC_HORIZON_URL,
      env.NEXT_PUBLIC_SOROBAN_RPC_URL,
      env.HORIZON_URL,
    ],
    convexUrls: [
      env.NEXT_PUBLIC_CONVEX_URL,
      env.CONVEX_URL,
      env.CONVEX_SELF_HOSTED_URL,
    ],
    convexDeployment: env.CONVEX_DEPLOYMENT,
    convexDeployKey: env.CONVEX_DEPLOY_KEY,
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
  })
}

/**
 * Convex-only variant for tools that change a deployment but never touch
 * Stellar (for example pushing functions with `convex dev`).
 */
export function assertScriptNonProductionConvex(
  operation: string,
  env: EnvLike = process.env
): NetworkGuardResult {
  return assertTestnetOnly({
    operation,
    checkStellar: false,
    requireConvexTarget: true,
    optIn: env[NETWORK_GUARD_OPT_IN_ENV],
    convexUrls: [
      env.NEXT_PUBLIC_CONVEX_URL,
      env.CONVEX_URL,
      env.CONVEX_SELF_HOSTED_URL,
    ],
    convexDeployment: env.CONVEX_DEPLOYMENT,
    convexDeployKey: env.CONVEX_DEPLOY_KEY,
    extraProductionDeployments: env[EXTRA_PRODUCTION_DEPLOYMENTS_ENV],
  })
}
