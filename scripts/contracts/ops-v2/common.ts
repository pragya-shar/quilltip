/**
 * Shared setup for the v2 chain operations scripts
 * (docs/architecture/v2/07-security-and-recovery.md, section 7.4).
 *
 * Every script calls `opsContext` first. It runs the Stellar-only network
 * guard before it reads a key, a state file or the network, then loads the
 * set's deployment state written by deploy-v2-testnet.ts.
 *
 * Scripts are dry runs unless `--submit` is given.
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import {
  CONTRACTS,
  SETS,
  identityName,
  type ContractName,
  type ContractSet,
} from '../deploy-v2/config'
import { assertKeysDirOutsideRepo, restrictKeyFiles } from '../deploy-v2/keys'
import {
  resolveDeployNetwork,
  type CliContext,
  type DeployNetwork,
  type TxRecord,
} from '../deploy-v2/network'
import { loadState, type DeployState } from '../deploy-v2/state'

type EnvLike = Record<string, string | undefined>

/** Ledgers per day at the 5-second target close time. */
export const LEDGERS_PER_DAY = 17_280

export type ParsedArgs = {
  set: ContractSet
  keysDir: string
  stateFile?: string
  submit: boolean
  values: Map<string, string>
  flags: Set<string>
}

export type ArgSpec = {
  usage: string
  /** Options that take a value, besides --set, --keys-dir and --state-file. */
  values?: readonly string[]
  /** Options without a value, besides --submit. */
  flags?: readonly string[]
}

/** Parses `--name value`, `--name=value` and flags. Unknown options fail. */
export function parseOpsArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const valueNames = new Set([
    'set',
    'keys-dir',
    'state-file',
    ...(spec.values ?? []),
  ])
  const flagNames = new Set(['submit', ...(spec.flags ?? [])])
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected argument ${arg}\n${spec.usage}`)
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq === -1 ? undefined : eq)
    if (flagNames.has(name)) {
      if (eq !== -1) throw new Error(`--${name} takes no value\n${spec.usage}`)
      flags.add(name)
      continue
    }
    if (!valueNames.has(name))
      throw new Error(`Unknown option --${name}\n${spec.usage}`)
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined || value === '' || value.startsWith('--'))
      throw new Error(`--${name} needs a value\n${spec.usage}`)
    values.set(name, value)
  }
  const set = values.get('set')
  if (!set || !(SETS as readonly string[]).includes(set))
    throw new Error(`--set must be integration or live\n${spec.usage}`)
  const keysDir = values.get('keys-dir')
  if (!keysDir) throw new Error(`--keys-dir is required\n${spec.usage}`)
  return {
    set: set as ContractSet,
    keysDir,
    stateFile: values.get('state-file'),
    submit: flags.has('submit'),
    values,
    flags,
  }
}

/** A positive number option, or the default. */
export function numberOption(
  args: ParsedArgs,
  name: string,
  fallback: number
): number {
  const raw = args.values.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${name} must be a positive number`)
  return value
}

/** A comma-separated subset of the three contracts (default: all). */
export function contractsOption(
  args: ParsedArgs,
  name = 'contracts'
): ContractName[] {
  const raw = args.values.get(name)
  if (!raw) return [...CONTRACTS]
  const list = raw.split(',').map((c) => c.trim())
  for (const c of list) {
    if (!(CONTRACTS as readonly string[]).includes(c))
      throw new Error(`Unknown contract ${c}; use core, tab or nft`)
  }
  return list as ContractName[]
}

export type OpsContext = {
  operation: string
  args: ParsedArgs
  net: DeployNetwork
  ctx: CliContext
  setDir: string
  statePath: string
  state: DeployState
  repoRoot: string
  log: (line: string) => void
  /** Identity name of a set key in the CLI config directory. */
  identity: (key: string) => string
}

function repoRootOf(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
}

/**
 * Runs the guard, then loads the set's deployment state. `requireContracts`
 * refuses a state without the three contract IDs.
 */
export function opsContext(
  operation: string,
  args: ParsedArgs,
  env: EnvLike,
  options: { requireContracts?: boolean } = {}
): OpsContext {
  // The guard runs before anything else.
  const net = resolveDeployNetwork(env, operation)
  const repoRoot = repoRootOf()
  const keysRoot = assertKeysDirOutsideRepo(args.keysDir, repoRoot)
  const setDir = join(keysRoot, args.set)
  const statePath = resolve(args.stateFile ?? join(setDir, 'deploy-state.json'))
  if (!existsSync(statePath)) {
    throw new Error(
      `${statePath} does not exist. Deploy the set with deploy-v2-testnet.ts first.`
    )
  }
  restrictKeyFiles(setDir)
  const state = loadState(statePath, {
    set: args.set,
    network: net.network,
    passphrase: net.passphrase,
  })
  if (options.requireContracts !== false) {
    for (const c of CONTRACTS) {
      if (!state.contracts?.[c]?.id)
        throw new Error(`${statePath} records no ${c} contract.`)
    }
  }
  const mode = args.submit ? 'SUBMIT' : 'DRY RUN'
  const log = (line: string) =>
    console.log(`[${operation} ${args.set} ${net.network} ${mode}] ${line}`)
  return {
    operation,
    args,
    net,
    ctx: { net, configDir: setDir, env },
    setDir,
    statePath,
    state,
    repoRoot,
    log,
    identity: (key) => identityName(args.set, key),
  }
}

export function contractId(o: OpsContext, c: ContractName): string {
  const id = o.state.contracts?.[c]?.id
  if (!id) throw new Error(`No ${c} contract in ${o.statePath}`)
  return id
}

/** One line per submitted operation, appended to `<set>/ops-log.json`. */
export type OpsLogEntry = {
  at: string
  operation: string
  network: string
  action: string
  tx: TxRecord | null
  detail?: string
}

export function appendOpsLog(o: OpsContext, entry: OpsLogEntry): void {
  const path = join(o.setDir, 'ops-log.json')
  const log = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as OpsLogEntry[])
    : []
  log.push(entry)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(log, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

/** Prints rows as an aligned text table. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]!))
      .join('  ')
      .trimEnd()
  return [
    line(headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map(line),
  ].join('\n')
}

/** Shell-quotes a command for a dry-run listing. */
export function shellLine(command: string, args: string[]): string {
  const quote = (a: string) =>
    /^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`
  return [command, ...args].map(quote).join(' ')
}
