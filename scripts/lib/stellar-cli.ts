/**
 * Stellar CLI wrapper for scripts.
 *
 * Every script that calls the `stellar` CLI builds its command here. The
 * wrapper runs the operational network guard first, then passes `--network`,
 * `--rpc-url`, and `--network-passphrase` explicitly, so the CLI never falls
 * back to its own defaults or to a network configured on this machine.
 */
import { spawnSync, type SpawnSyncReturns } from 'child_process'

import { NetworkGuardError, resolveScriptStellarNetwork } from './network-guard'

type EnvLike = Record<string, string | undefined>

/** Flags the wrapper sets itself. Callers must not pass them. */
const NETWORK_FLAGS = ['--network', '--rpc-url', '--network-passphrase', '-n']

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

function refuseNetworkFlags(operation: string, args: string[]): void {
  const refused = args.filter((arg) =>
    NETWORK_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
  )
  if (refused.length > 0) {
    const names = [...new Set(refused.map((arg) => arg.split('=')[0]))]
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
  env: EnvLike = process.env
): string[] {
  const network = resolveScriptStellarNetwork(operation, env)
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
 */
export function buildStellarCliCommand(
  operation: string,
  args: string[],
  env: EnvLike = process.env
): StellarCliCommand {
  refuseNetworkFlags(operation, args)
  const network = resolveScriptStellarNetwork(operation, env)
  const childEnv: EnvLike = { ...env }
  for (const name of CLI_NETWORK_ENV) delete childEnv[name]
  childEnv.STELLAR_NETWORK = network.cliNetwork
  childEnv.STELLAR_RPC_URL = network.rpcUrl
  childEnv.STELLAR_NETWORK_PASSPHRASE = network.passphrase
  return {
    command: 'stellar',
    args: [
      ...args,
      '--network',
      network.cliNetwork,
      '--rpc-url',
      network.rpcUrl,
      '--network-passphrase',
      network.passphrase,
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
  options: { env?: EnvLike; spawn?: Spawn } = {}
): SpawnSyncReturns<string> {
  const built = buildStellarCliCommand(operation, args, options.env)
  const spawn = options.spawn ?? (spawnSync as unknown as Spawn)
  return spawn(built.command, built.args, {
    env: built.env,
    encoding: 'utf8',
  })
}
