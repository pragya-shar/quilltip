/**
 * Fills a gap in the v2 event index
 * (docs/architecture/v2/07-security-and-recovery.md, section 7.4, "Indexer
 * behind retention").
 *
 *   bun scripts/chain/backfill-events.ts --set integration \
 *     --keys-dir <directory outside the repo> --from-ledger <n> [--submit]
 *
 * - Guarded by `assertScriptTestnetOnly`, because it writes to Convex: the
 *   Stellar network must be testnet (or a local network) and the Convex
 *   target allowlisted (or local). Mainnet is refused in every form.
 * - Reads the set's contract IDs from `<keys-dir>/<set>/deploy-state.json`.
 * - Reads the events of the three contracts from `--from-ledger` to
 *   `--to-ledger` (default: the latest ledger) with RPC `getEvents`, or from
 *   `--events-file` (an export in `getEvents` format from an archive RPC or a
 *   hosted indexer).
 * - When the range starts before the oldest ledger the RPC server keeps, it
 *   stops, writes nothing, and prints the recovery steps.
 * - A dry run by default: it prints what it found and writes the events to a
 *   JSON file. `--submit` writes them through the internal mutation
 *   `chain/indexer:ingestBackfill`. Stored events are skipped and handlers are
 *   idempotent, so a rerun changes nothing.
 * - `--resume` then points the indexer at the ledger after the range
 *   (`chain/indexer:replayFrom` with `gapBackfilled`).
 */
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import {
  CONTRACTS,
  SETS,
  type ContractSet,
} from '../contracts/deploy-v2/config'
import { assertKeysDirOutsideRepo } from '../contracts/deploy-v2/keys'
import {
  LOCAL_PASSPHRASE,
  TESTNET_PASSPHRASE,
  confirmNetwork,
  rpc,
  type DeployNetwork,
} from '../contracts/deploy-v2/network'
import { loadState } from '../contracts/deploy-v2/state'
import { ledgerOfCursor } from '../contracts/ops-v2/ledger'
import {
  NetworkGuardError,
  resolveScriptStellarNetwork,
} from '../lib/network-guard'

export const OPERATION = 'backfill-events'

type EnvLike = Record<string, string | undefined>

export const USAGE = `Usage: bun scripts/chain/backfill-events.ts --set integration|live --keys-dir <dir> --from-ledger <n> [options]

  --to-ledger <n>       Last ledger to read (default: the latest ledger)
  --events-file <path>  Read events from this file instead of RPC
  --out <path>          Where the dry run writes the events
                        (default: <keys-dir>/<set>/backfill-<from>-<to>.json)
  --chunk <n>           Events per Convex mutation (default: 100, at most 250)
  --submit              Write the events to Convex (default: dry run)
  --resume              After writing, make the indexer read from <to> + 1
  --state-file <path>   Default: <keys-dir>/<set>/deploy-state.json

The Convex target is CONVEX_DEPLOYMENT (or CONVEX_SELF_HOSTED_URL for a local
backend), checked by the network guard. It must run this set's contracts.`

export type BackfillOptions = {
  set: ContractSet
  keysDir: string
  stateFile?: string
  fromLedger: number
  toLedger?: number
  eventsFile?: string
  out?: string
  chunk: number
  submit: boolean
  resume: boolean
}

function ledgerValue(name: string, raw: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive ledger number\n${USAGE}`)
  return value
}

export function parseArgs(argv: string[]): BackfillOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  const valueNames = new Set([
    'set',
    'keys-dir',
    'state-file',
    'from-ledger',
    'to-ledger',
    'events-file',
    'out',
    'chunk',
  ])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected argument ${arg}\n${USAGE}`)
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq === -1 ? undefined : eq)
    if (name === 'submit' || name === 'resume') {
      if (eq !== -1) throw new Error(`--${name} takes no value\n${USAGE}`)
      flags.add(name)
      continue
    }
    if (!valueNames.has(name))
      throw new Error(`Unknown option --${name}\n${USAGE}`)
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined || value === '' || value.startsWith('--'))
      throw new Error(`--${name} needs a value\n${USAGE}`)
    values.set(name, value)
  }
  const set = values.get('set')
  if (!set || !(SETS as readonly string[]).includes(set))
    throw new Error(`--set must be integration or live\n${USAGE}`)
  const keysDir = values.get('keys-dir')
  if (!keysDir) throw new Error(`--keys-dir is required\n${USAGE}`)
  const from = values.get('from-ledger')
  if (!from) throw new Error(`--from-ledger is required\n${USAGE}`)
  const fromLedger = ledgerValue('from-ledger', from)
  const to = values.get('to-ledger')
  const toLedger = to === undefined ? undefined : ledgerValue('to-ledger', to)
  if (toLedger !== undefined && toLedger < fromLedger)
    throw new Error(`--to-ledger is before --from-ledger\n${USAGE}`)
  const chunk = Number(values.get('chunk') ?? '100')
  if (!Number.isSafeInteger(chunk) || chunk < 1 || chunk > 250)
    throw new Error(`--chunk must be 1 to 250\n${USAGE}`)
  if (flags.has('resume') && !flags.has('submit'))
    throw new Error(`--resume needs --submit\n${USAGE}`)
  return {
    set: set as ContractSet,
    keysDir,
    stateFile: values.get('state-file'),
    fromLedger,
    toLedger,
    eventsFile: values.get('events-file'),
    out: values.get('out'),
    chunk,
    submit: flags.has('submit'),
    resume: flags.has('resume'),
  }
}

/**
 * The guard for a script that writes to Convex, then the Stellar network to
 * read from. Refuses unless the passphrase is the testnet (or local) one.
 */
export function resolveBackfillNetwork(env: EnvLike): DeployNetwork {
  const resolved = resolveScriptStellarNetwork(OPERATION, env)
  const network = resolved.guard.network
  const expected = network === 'LOCAL' ? LOCAL_PASSPHRASE : TESTNET_PASSPHRASE
  if (resolved.passphrase !== expected) {
    throw new NetworkGuardError(OPERATION, [
      {
        code: 'UNKNOWN_PASSPHRASE',
        message: `The resolved passphrase is not "${expected}".`,
      },
    ])
  }
  return {
    operation: OPERATION,
    network,
    passphrase: resolved.passphrase,
    rpcUrl: resolved.rpcUrl,
    explorer: network === 'TESTNET' ? 'testnet' : null,
  }
}

/**
 * Environment for the Convex CLI. The guard has checked this environment's
 * target. Unset target variables become empty strings, so the CLI's
 * `.env.local` loading cannot add a deploy key or URL that would win over it.
 */
export function convexRunEnv(env: EnvLike): EnvLike {
  const targets = [
    'CONVEX_DEPLOYMENT',
    'CONVEX_DEPLOY_KEY',
    'CONVEX_DEPLOYMENT_TOKEN',
    'CONVEX_SELF_HOSTED_URL',
  ]
  if (!targets.some((name) => env[name]?.trim())) {
    throw new NetworkGuardError(OPERATION, [
      {
        code: 'UNKNOWN_CONVEX',
        message:
          'No Convex CLI target is set. Set CONVEX_DEPLOYMENT (or CONVEX_SELF_HOSTED_URL for a local backend).',
      },
    ])
  }
  const out: EnvLike = { ...env }
  for (const name of [...targets, 'CONVEX_SELF_HOSTED_ADMIN_KEY']) {
    if (!out[name]?.trim()) out[name] = ''
  }
  return out
}

/** The fields `chain/indexer:ingestBackfill` accepts. */
export type BackfillEvent = {
  type: string
  ledger: number
  ledgerClosedAt: string
  contractId: string
  id: string
  operationIndex?: number
  transactionIndex?: number
  txHash: string
  topic: string[]
  value: string
  inSuccessfulContractCall?: boolean
}

/** Validates one event and keeps only the accepted fields. */
export function toBackfillEvent(raw: unknown, index: number): BackfillEvent {
  const e = (raw ?? {}) as Record<string, unknown>
  const str = (name: string) => {
    if (typeof e[name] !== 'string' || e[name] === '')
      throw new Error(`Event ${index}: ${name} must be a non-empty string.`)
    return e[name] as string
  }
  if (!Number.isSafeInteger(e.ledger))
    throw new Error(`Event ${index}: ledger must be an integer.`)
  if (!Array.isArray(e.topic) || !e.topic.every((t) => typeof t === 'string'))
    throw new Error(`Event ${index}: topic must be an array of strings.`)
  const out: BackfillEvent = {
    type: str('type'),
    ledger: e.ledger as number,
    ledgerClosedAt: str('ledgerClosedAt'),
    contractId: str('contractId'),
    id: str('id'),
    txHash: str('txHash'),
    topic: e.topic as string[],
    value: str('value'),
  }
  if (typeof e.operationIndex === 'number')
    out.operationIndex = e.operationIndex
  if (typeof e.transactionIndex === 'number')
    out.transactionIndex = e.transactionIndex
  if (typeof e.inSuccessfulContractCall === 'boolean')
    out.inSuccessfulContractCall = e.inSuccessfulContractCall
  return out
}

/** Keeps the set's events inside the range, ordered by ledger and ID. */
export function selectEvents(
  events: BackfillEvent[],
  contractIds: string[],
  from: number,
  to: number
): { kept: BackfillEvent[]; dropped: number } {
  const ids = new Set(contractIds)
  const seen = new Set<string>()
  const kept: BackfillEvent[] = []
  for (const e of events) {
    if (!ids.has(e.contractId) || e.ledger < from || e.ledger > to) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    kept.push(e)
  }
  kept.sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id))
  return { kept, dropped: events.length - kept.length }
}

/** Steps printed when the range is older than the RPC server keeps. */
export function retentionInstructions(
  options: Pick<BackfillOptions, 'set' | 'fromLedger'>,
  toLedger: number,
  oldestLedger: number
): string {
  const gapEnd = Math.min(toLedger, oldestLedger - 1)
  return [
    `Ledgers ${options.fromLedger} to ${gapEnd} are older than the oldest ledger this RPC server keeps (${oldestLedger}). Nothing was written.`,
    '',
    'To fill the gap:',
    '1. Keep CHAIN_V2_ENABLED=false on the Convex deployment until the index is complete.',
    `2. Export the events of the ${options.set} set's three contracts for ledgers ${options.fromLedger} to ${gapEnd} in RPC getEvents format, from a source that still holds them: an RPC provider with a longer history, or a hosted indexer. Scripts accept only the testnet RPC hosts listed in the network guard; adding a provider is a reviewed change.`,
    `3. Write them: --events-file <export.json> --from-ledger ${options.fromLedger} --to-ledger ${gapEnd} --submit.`,
    oldestLedger <= toLedger
      ? `4. Fill the rest from RPC: --from-ledger ${oldestLedger} --submit --resume.`
      : '4. Run the indexer again: --resume on the last write, or chain/indexer:replayFrom with gapBackfilled.',
    '5. Reconcile, then set CHAIN_V2_ENABLED=true. Records that no source can resolve stay flagged for manual review.',
  ].join('\n')
}

type EventsPage = { events: unknown[]; cursor?: string; latestLedger: number }

async function readRpcEvents(
  net: DeployNetwork,
  contractIds: string[],
  from: number,
  to: number
): Promise<BackfillEvent[]> {
  const events: BackfillEvent[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10_000; page++) {
    const result = await rpc<EventsPage>(net, 'getEvents', {
      filters: [{ type: 'contract', contractIds }],
      pagination: cursor ? { cursor, limit: 1000 } : { limit: 1000 },
      ...(cursor ? {} : { startLedger: from }),
    })
    result.events.forEach((e, i) => events.push(toBackfillEvent(e, i)))
    const cursorLedger = result.cursor ? ledgerOfCursor(result.cursor) : null
    const reachedEnd =
      cursorLedger !== null &&
      (cursorLedger >= to || cursorLedger >= result.latestLedger) &&
      result.events.length < 1000
    const pastRange =
      events.length > 0 && events[events.length - 1]!.ledger > to
    if (reachedEnd || pastRange || !result.cursor || result.cursor === cursor)
      break
    cursor = result.cursor
  }
  return events
}

/** Runs `convex <args>` with the checked environment. Injected in tests. */
export type ConvexCli = (
  args: string[],
  env: EnvLike
) => { status: number | null; stdout: string; stderr: string }

const runConvex: ConvexCli = (args, env) => {
  const result = spawnSync('bunx', ['convex', ...args], {
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

export async function main(
  argv: string[],
  env: EnvLike = process.env,
  convex: ConvexCli = runConvex
): Promise<number> {
  const options = parseArgs(argv)
  // The guard runs before anything else.
  const net = resolveBackfillNetwork(env)
  const convexEnv = convexRunEnv(env)
  const keysRoot = assertKeysDirOutsideRepo(options.keysDir)
  const setDir = join(keysRoot, options.set)
  const statePath = resolve(
    options.stateFile ?? join(setDir, 'deploy-state.json')
  )
  if (!existsSync(statePath))
    throw new Error(`${statePath} does not exist. Deploy the set first.`)
  const state = loadState(statePath, {
    set: options.set,
    network: net.network,
    passphrase: net.passphrase,
  })
  const contractIds = CONTRACTS.map((c) => {
    const id = state.contracts?.[c]?.id
    if (!id) throw new Error(`${statePath} records no ${c} contract.`)
    return id
  })
  const mode = options.submit ? 'SUBMIT' : 'DRY RUN'
  const log = (line: string) =>
    console.log(`[${OPERATION} ${options.set} ${net.network} ${mode}] ${line}`)
  log(
    `network ${net.network}, RPC ${net.rpcUrl}, passphrase "${net.passphrase}"`
  )
  await confirmNetwork(net)

  const health = await rpc<{ latestLedger: number; oldestLedger: number }>(
    net,
    'getHealth',
    {}
  )
  const toLedger = options.toLedger ?? health.latestLedger
  if (toLedger > health.latestLedger)
    throw new Error(
      `--to-ledger ${toLedger} is after the latest ledger ${health.latestLedger}.`
    )

  let source: BackfillEvent[]
  if (options.eventsFile) {
    const raw = JSON.parse(readFileSync(options.eventsFile, 'utf8')) as unknown
    if (!Array.isArray(raw))
      throw new Error('The events file must hold a JSON array.')
    source = raw.map((e, i) => toBackfillEvent(e, i))
    log(`read ${source.length} events from ${options.eventsFile}`)
  } else {
    if (options.fromLedger < health.oldestLedger) {
      console.log(
        `\n${retentionInstructions(options, toLedger, health.oldestLedger)}\n`
      )
      return 2
    }
    source = await readRpcEvents(net, contractIds, options.fromLedger, toLedger)
    log(
      `read ${source.length} events from RPC (ledgers ${options.fromLedger} to ${toLedger})`
    )
  }
  const { kept, dropped } = selectEvents(
    source,
    contractIds,
    options.fromLedger,
    toLedger
  )
  if (dropped > 0)
    log(
      `${dropped} events are outside the range or other contracts, or repeat an ID; skipped`
    )
  const byContract = new Map<string, number>()
  for (const e of kept)
    byContract.set(e.contractId, (byContract.get(e.contractId) ?? 0) + 1)
  for (const c of CONTRACTS) {
    log(`${c}: ${byContract.get(state.contracts![c]!.id) ?? 0} events`)
  }
  const out = resolve(
    options.out ??
      join(setDir, `backfill-${options.fromLedger}-${toLedger}.json`)
  )
  writeFileSync(out, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 })
  log(`events written to ${out}`)

  if (!options.submit) {
    log(
      `dry run: nothing was written to Convex. Add --submit to write ${kept.length} events.`
    )
    return 0
  }

  // The deployment must run this set's contracts.
  const coreEnv = convex(['env', 'get', 'CORE_CONTRACT_ID'], convexEnv)
  const deployedCore = coreEnv.status === 0 ? coreEnv.stdout : ''
  if (deployedCore !== state.contracts!.core!.id) {
    throw new Error(
      `The Convex deployment's CORE_CONTRACT_ID is "${deployedCore}", not the ${options.set} set's ${state.contracts!.core!.id}. Nothing was written.`
    )
  }
  let stored = 0
  let duplicates = 0
  for (let i = 0; i < kept.length; i += options.chunk) {
    const part = kept.slice(i, i + options.chunk)
    const result = convex(
      ['run', 'chain/indexer:ingestBackfill', JSON.stringify({ events: part })],
      convexEnv
    )
    if (result.status !== 0) {
      throw new Error(
        `chain/indexer:ingestBackfill failed after ${i} of ${kept.length} events:\n${result.stderr.split('\n').slice(-5).join('\n')}\nRerun the same command; stored events are skipped.`
      )
    }
    const counts = JSON.parse(result.stdout || '{}') as {
      stored?: number
      duplicates?: number
    }
    stored += counts.stored ?? 0
    duplicates += counts.duplicates ?? 0
    log(`wrote events ${i + 1} to ${i + part.length}`)
  }
  log(`backfill: ${stored} stored, ${duplicates} already stored`)

  if (options.resume) {
    if (toLedger + 1 < health.oldestLedger) {
      throw new Error(
        `Ledger ${toLedger + 1} is older than the RPC server keeps; fill the rest of the gap before resuming.`
      )
    }
    const result = convex(
      [
        'run',
        'chain/indexer:replayFrom',
        JSON.stringify({ fromLedger: toLedger + 1, gapBackfilled: true }),
      ],
      convexEnv
    )
    if (result.status !== 0) {
      throw new Error(
        `chain/indexer:replayFrom failed:\n${result.stderr.split('\n').slice(-5).join('\n')}`
      )
    }
    log(`indexer resumes from ledger ${toLedger + 1}`)
  } else {
    log(
      `next: rerun with --resume, or run chain/indexer:replayFrom with {"fromLedger": ${toLedger + 1}, "gapBackfilled": true}`
    )
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
