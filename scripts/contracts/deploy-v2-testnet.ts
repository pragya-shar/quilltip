/**
 * Deploys the payments v2 contracts (Core, Tab, Article NFT) to Stellar
 * testnet, or to a local standalone network, and writes the evidence.
 * Specification: docs/architecture/v2/08-testing-and-deployment.md, section 8.4.
 *
 *   QUILLTIP_NETWORK_GUARD_OPT_IN=testnet NEXT_PUBLIC_STELLAR_NETWORK=TESTNET \
 *   NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
 *   NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015' \
 *   bun scripts/contracts/deploy-v2-testnet.ts --set integration \
 *     --commit <sha on origin/overhaul/v2> --keys-dir <directory outside the repo>
 *
 * - Guarded by `assertScriptStellarTestnetOnly`: mainnet is refused in every
 *   form, and every submission first confirms the RPC server's passphrase.
 * - The Stellar CLI always gets `--network`, `--rpc-url` and
 *   `--network-passphrase` from the guarded environment.
 * - Steps: build, keys, upload, deploy, verify, smoke, evidence. Each records
 *   its result in the state file and is skipped on a rerun, so a failed run
 *   resumes where it stopped. `--steps` runs a subset.
 * - Keys are Stellar CLI identities in `--keys-dir/<set>` (mode 600). No
 *   secret is printed or written anywhere else.
 * - The script touches no Convex deployment and changes no app environment.
 */
import { execFileSync } from 'child_process'
import { join, resolve } from 'path'

import { SETS, type ContractSet } from './deploy-v2/config'
import { stepConvexEnv } from './deploy-v2/convex-env'
import { writeEvidence } from './deploy-v2/evidence'
import { assertKeysDirOutsideRepo, restrictKeyFiles } from './deploy-v2/keys'
import { resolveDeployNetwork, type CliContext } from './deploy-v2/network'
import { loadState, saveState } from './deploy-v2/state'
import {
  gitCommitOnBase,
  stepBuild,
  stepDeploy,
  stepKeys,
  stepSmoke,
  stepUpload,
  stepVerify,
  type StepContext,
} from './deploy-v2/steps'

export const STEPS = [
  'build',
  'keys',
  'upload',
  'deploy',
  'verify',
  'smoke',
  'evidence',
  'convex-env',
] as const
type Step = (typeof STEPS)[number]

export type DeployOptions = {
  set: ContractSet
  steps: Step[]
  commit: string
  keysDir: string
  stateFile?: string
  buildDir?: string
  evidence?: string
  nftBaseUri?: string
  baseRef: string
}

const USAGE = `Usage: bun scripts/contracts/deploy-v2-testnet.ts --set integration|live --commit <sha> --keys-dir <dir> [options]

  --steps <list>       Comma-separated subset of ${STEPS.join(',')} (default: all but convex-env)
  --base-ref <ref>     A testnet commit must be on this ref (default: origin/overhaul/v2)
  --state-file <path>  Default: <keys-dir>/<set>/deploy-state.json
  --build-dir <dir>    Default: <keys-dir>/<set>/build
  --evidence <path>    Default: docs/contracts/v2-testnet-deployment.md on testnet,
                       <keys-dir>/<set>/v2-local-deployment.md on a local network
  --nft-base-uri <url> Default: https://www.quilltip.me/api/nft/`

export function parseArgs(argv: string[]): DeployOptions {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected argument ${arg}\n${USAGE}`)
    const [name, inline] = arg.slice(2).split('=', 2)
    const value = inline ?? argv[++i]
    if (value === undefined)
      throw new Error(`--${name} needs a value\n${USAGE}`)
    values.set(name!, value)
  }
  const set = values.get('set')
  if (!set || !(SETS as readonly string[]).includes(set))
    throw new Error(`--set must be integration or live\n${USAGE}`)
  const commit = values.get('commit')
  if (!commit || !/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`--commit must be a full 40-character commit SHA\n${USAGE}`)
  const keysDir = values.get('keys-dir')
  if (!keysDir) throw new Error(`--keys-dir is required\n${USAGE}`)
  const steps = (
    values.get('steps') ?? STEPS.filter((s) => s !== 'convex-env').join(',')
  )
    .split(',')
    .map((s) => s.trim())
  for (const step of steps) {
    if (!(STEPS as readonly string[]).includes(step))
      throw new Error(`Unknown step ${step}\n${USAGE}`)
  }
  return {
    set: set as ContractSet,
    steps: steps as Step[],
    commit,
    keysDir,
    stateFile: values.get('state-file'),
    buildDir: values.get('build-dir'),
    evidence: values.get('evidence'),
    nftBaseUri: values.get('nft-base-uri'),
    baseRef: values.get('base-ref') ?? 'origin/overhaul/v2',
  }
}

function toolVersions(): Record<string, string> {
  const run = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' })
        .split('\n')[0]!
        .trim()
    } catch {
      return 'unknown'
    }
  }
  return {
    'Stellar CLI (operator)': run('stellar', ['--version']),
    'Rust toolchain': 'contracts/rust-toolchain.toml (1.94.1)',
  }
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const options = parseArgs(argv)
  // The guard runs before anything else, including key and build work.
  const net = resolveDeployNetwork(env)
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
  if (
    net.network === 'TESTNET' &&
    !gitCommitOnBase(repoRoot, options.commit, options.baseRef)
  ) {
    throw new Error(
      `${options.commit} is not on ${options.baseRef}. Testnet deployments use a commit on the integration branch.`
    )
  }
  const keysRoot = assertKeysDirOutsideRepo(options.keysDir, repoRoot)
  const setDir = join(keysRoot, options.set)
  restrictKeyFiles(setDir)
  const ctx: CliContext = { net, configDir: setDir, env }
  const statePath = resolve(
    options.stateFile ?? join(setDir, 'deploy-state.json')
  )
  const state = loadState(statePath, {
    set: options.set,
    network: net.network,
    passphrase: net.passphrase,
  })
  if (state.commit && state.commit !== options.commit) {
    throw new Error(
      `${statePath} records commit ${state.commit}. Use a new --keys-dir or --state-file for another commit.`
    )
  }
  const log = (line: string) =>
    console.log(`[deploy-v2 ${options.set} ${net.network}] ${line}`)
  const s: StepContext = {
    ctx,
    set: options.set,
    state,
    statePath,
    repoRoot,
    log,
  }
  log(
    `network ${net.network}, RPC ${net.rpcUrl}, passphrase "${net.passphrase}"`
  )

  const run = new Set(options.steps)
  if (run.has('build'))
    stepBuild(
      s,
      options.commit,
      resolve(options.buildDir ?? join(setDir, 'build'))
    )
  if (run.has('keys')) await stepKeys(s)
  if (run.has('upload')) await stepUpload(s)
  if (run.has('deploy'))
    await stepDeploy(
      s,
      options.nftBaseUri ?? 'https://www.quilltip.me/api/nft/'
    )
  if (run.has('verify')) stepVerify(s)
  if (run.has('smoke')) await stepSmoke(s)
  if (run.has('evidence')) {
    const evidence = resolve(
      options.evidence ??
        (net.network === 'TESTNET'
          ? join(repoRoot, 'docs/contracts/v2-testnet-deployment.md')
          : join(setDir, 'v2-local-deployment.md'))
    )
    writeEvidence(evidence, s.state, net, toolVersions())
    log(`evidence: ${evidence}`)
  }
  if (run.has('convex-env')) {
    const names = await stepConvexEnv(ctx, s.state, log)
    s.state.convexEnv = { at: new Date().toISOString(), names }
    saveState(statePath, s.state)
  }
  restrictKeyFiles(setDir)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
