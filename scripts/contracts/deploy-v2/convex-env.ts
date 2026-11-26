/**
 * Section 8.4, step 10: set the integration contract set's values on the
 * integration Convex deployment. Runs only for `--set integration` on
 * testnet, behind the deploy-kind Convex guard, which refuses the live
 * deployment. Values go to the Convex CLI on stdin, never as arguments, and
 * are never printed.
 */
import { spawnSync } from 'child_process'

import {
  ALLOWED_CONVEX_DEPLOYMENTS,
  LIVE_CONVEX_DEPLOYMENTS,
} from '../../../convex/lib/networkGuard'
import { assertScriptConvexDeployAllowed } from '../../lib/network-guard'
import { identityName } from './config'
import { signer } from './keys'
import type { CliContext } from './network'
import type { DeployState } from './state'

type EnvLike = Record<string, string | undefined>

/** The one allowlisted non-live deployment, which runs the integration set. */
export const INTEGRATION_CONVEX_DEPLOYMENT = ALLOWED_CONVEX_DEPLOYMENTS[0]!

/** Variable names this step sets (06-app-integration.md, section 6.8). */
export const CONVEX_ENV_NAMES = [
  'CORE_CONTRACT_ID',
  'TAB_CONTRACT_ID',
  'NFT_CONTRACT_ID',
  'TOKEN_CONTRACT_ID',
  'INDEXER_START_LEDGER',
  'TAB_SETTLER_SECRET',
  'TAB_ACCEPTOR_SECRET',
] as const

/** Environment for the Convex CLI, checked by the deploy-kind guard. */
export function convexCliEnv(deployment: string, env: EnvLike): EnvLike {
  if (LIVE_CONVEX_DEPLOYMENTS.includes(deployment)) {
    throw new Error(
      `${deployment} is the live deployment. This step never writes to it.`
    )
  }
  const convexEnv: EnvLike = {
    ...env,
    CONVEX_DEPLOYMENT: `dev:${deployment}`,
    CONVEX_DEPLOY_KEY: undefined,
    NEXT_PUBLIC_CONVEX_URL: `https://${deployment}.convex.cloud`,
  }
  assertScriptConvexDeployAllowed('deploy-v2-testnet convex-env', convexEnv)
  return convexEnv
}

type Run = (
  args: string[],
  env: EnvLike,
  input?: string
) => { status: number | null; stdout: string }

const runConvex: Run = (args, env, input) => {
  const result = spawnSync('bunx', ['convex', ...args], {
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    input,
  })
  return { status: result.status, stdout: (result.stdout ?? '').trim() }
}

export async function stepConvexEnv(
  ctx: CliContext,
  state: DeployState,
  log: (line: string) => void,
  run: Run = runConvex
): Promise<string[]> {
  if (state.set !== 'integration' || state.network !== 'TESTNET') {
    throw new Error('convex-env runs only for the integration set on testnet.')
  }
  const c = state.contracts
  if (!c?.core || !c.tab || !c.nft || !state.nativeSac || !state.verify?.ok) {
    throw new Error('Deploy and verify the integration set before convex-env.')
  }
  const deployment = INTEGRATION_CONVEX_DEPLOYMENT
  const env = convexCliEnv(deployment, ctx.env)

  // The backend must already run on testnet before it receives keys.
  const network = run(['env', 'get', 'STELLAR_NETWORK'], env)
  if (network.status !== 0 || network.stdout !== 'TESTNET') {
    throw new Error(
      `${deployment} does not report STELLAR_NETWORK=TESTNET. Nothing was set.`
    )
  }

  const values: Record<(typeof CONVEX_ENV_NAMES)[number], string> = {
    CORE_CONTRACT_ID: c.core.id,
    TAB_CONTRACT_ID: c.tab.id,
    NFT_CONTRACT_ID: c.nft.id,
    TOKEN_CONTRACT_ID: state.nativeSac,
    INDEXER_START_LEDGER: String(c.core.tx?.ledger ?? ''),
    TAB_SETTLER_SECRET: signer(
      ctx,
      identityName(state.set, 'settler')
    ).secret(),
    TAB_ACCEPTOR_SECRET: signer(
      ctx,
      identityName(state.set, 'acceptor')
    ).secret(),
  }
  if (!values.INDEXER_START_LEDGER)
    throw new Error('The Core deployment ledger is not recorded.')
  for (const name of CONVEX_ENV_NAMES) {
    const result = run(['env', 'set', name], env, values[name])
    if (result.status !== 0)
      throw new Error(`Setting ${name} on ${deployment} failed.`)
    log(`convex-env: set ${name} on ${deployment}`)
  }
  return [...CONVEX_ENV_NAMES]
}
