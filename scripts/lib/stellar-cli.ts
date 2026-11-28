/**
 * Stellar CLI wrapper for scripts.
 *
 * Every script that calls the `stellar` CLI builds its command here. The
 * wrapper runs the operational network guard first, then passes `--network`,
 * `--rpc-url`, and `--network-passphrase` explicitly, so the CLI never falls
 * back to its own defaults or to a network configured on this machine.
 */
import { spawnSync, type SpawnSyncReturns } from 'child_process'

import {
  NetworkGuardError,
  resolveScriptStellarNetwork,
  resolveScriptStellarOnlyNetwork,
} from './network-guard'

type EnvLike = Record<string, string | undefined>

/**
 * Which guard runs before a command. `convex` (the default) is
 * `assertScriptTestnetOnly`, which also checks the Convex target.
 * `stellar-only` is `assertScriptStellarTestnetOnly`, for tools that touch no
 * Convex backend. Both refuse mainnet.
 */
export type StellarCliGuardScope = 'convex' | 'stellar-only'

function resolveNetwork(
  operation: string,
  env: EnvLike,
  scope: StellarCliGuardScope
) {
  return scope === 'stellar-only'
    ? resolveScriptStellarOnlyNetwork(operation, env)
    : resolveScriptStellarNetwork(operation, env)
}

/** Long flags the wrapper sets itself. Callers must not pass them. */
const NETWORK_FLAGS = ['--network', '--rpc-url', '--network-passphrase']

/** Short form of `--network`, alone or in a group (`-n x`, `-nx`, `-qn x`). */
const SHORT_NETWORK_FLAG = /^-[A-Za-z]*n/

/** Ends the CLI's own options; later arguments go to the contract function. */
const OPTIONS_END = '--'

/** Stellar CLI env variables that could select another network. */
const CLI_NETWORK_ENV = [
  'STELLAR_NETWORK',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'STELLAR_RPC_HEADERS',
  'SOROBAN_NETWORK',
  'SOROBAN_RPC_URL',
  'SOROBAN_NETWORK_PASSPHRASE',
]

export type StellarCliCommand = {
  command: 'stellar'
  args: string[]
  /** Child env: the caller's env with the CLI network variables replaced. */
  env: EnvLike
  network: 'TESTNET' | 'LOCAL'
}

/** Split caller arguments at the first `--` (CLI options, then the rest). */
function splitAtOptionsEnd(args: string[]): [string[], string[]] {
  const end = args.indexOf(OPTIONS_END)
  return end === -1 ? [args, []] : [args.slice(0, end), args.slice(end)]
}

/** Flag name to print for a refused argument; never its value. */
function refusedFlagName(arg: string): string | null {
  for (const flag of NETWORK_FLAGS) {
    if (arg === flag || arg.startsWith(`${flag}=`)) return flag
  }
  return SHORT_NETWORK_FLAG.test(arg) ? '-n' : null
}

function refuseNetworkFlags(operation: string, options: string[]): void {
  const names = [
    ...new Set(
      options.map(refusedFlagName).filter((name): name is string => !!name)
    ),
  ]
  if (names.length > 0) {
    throw new NetworkGuardError(operation, [
      {
        code: 'CLI_NETWORK_FLAG',
        message: `Do not pass ${names.join(', ')}. The wrapper sets the network, RPC URL, and passphrase from the guarded environment.`,
      },
    ])
  }
}

/**
 * Network flags for the Stellar CLI, after the operational guard passes.
 * Returns `['--network', name, '--rpc-url', url, '--network-passphrase', p]`.
 */
export function stellarCliNetworkArgs(
  operation: string,
  env: EnvLike = process.env,
  scope: StellarCliGuardScope = 'convex'
): string[] {
  const network = resolveNetwork(operation, env, scope)
  return [
    '--network',
    network.cliNetwork,
    '--rpc-url',
    network.rpcUrl,
    '--network-passphrase',
    network.passphrase,
  ]
}

/**
 * Build a guarded Stellar CLI command. `args` is the subcommand and its own
 * flags, for example `['contract', 'deploy', '--wasm', path, '--source', id]`.
 * Arguments after `--` (contract function arguments) are passed on unchanged,
 * after the network flags.
 */
export function buildStellarCliCommand(
  operation: string,
  args: string[],
  env: EnvLike = process.env,
  scope: StellarCliGuardScope = 'convex'
): StellarCliCommand {
  // Arguments after `--` belong to the contract function, not to the CLI.
  const [options, functionArgs] = splitAtOptionsEnd(args)
  refuseNetworkFlags(operation, options)
  const network = resolveNetwork(operation, env, scope)
  const childEnv: EnvLike = { ...env }
  for (const name of CLI_NETWORK_ENV) delete childEnv[name]
  childEnv.STELLAR_NETWORK = network.cliNetwork
  childEnv.STELLAR_RPC_URL = network.rpcUrl
  childEnv.STELLAR_NETWORK_PASSPHRASE = network.passphrase
  return {
    command: 'stellar',
    args: [
      ...options,
      '--network',
      network.cliNetwork,
      '--rpc-url',
      network.rpcUrl,
      '--network-passphrase',
      network.passphrase,
      ...functionArgs,
    ],
    env: childEnv,
    network: network.guard.network,
  }
}

type Spawn = (
  command: string,
  args: string[],
  options: { env: EnvLike; encoding: 'utf8' }
) => SpawnSyncReturns<string>

/** Run a guarded Stellar CLI command and return its output. */
export function runStellarCli(
  operation: string,
  args: string[],
  options: { env?: EnvLike; spawn?: Spawn; scope?: StellarCliGuardScope } = {}
): SpawnSyncReturns<string> {
  const built = buildStellarCliCommand(
    operation,
    args,
    options.env,
    options.scope
  )
  const spawn = options.spawn ?? (spawnSync as unknown as Spawn)
  return spawn(built.command, built.args, {
    env: built.env,
    encoding: 'utf8',
  })
}
