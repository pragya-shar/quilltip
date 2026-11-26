/**
 * TTL report, extension and restore plans for a v2 contract set. Used by
 * extend-v2-testnet.ts and restore-v2-testnet.ts.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { CONTRACTS, type ContractName } from '../deploy-v2/config'
import { cliCommand } from '../deploy-v2/network'
import { contractId, shellLine, table, type OpsContext } from './common'
import {
  deploymentEntries,
  deploymentTxHashes,
  entriesFromFile,
  entriesFromFootprint,
  eventTxHashes,
  health,
  ledgersToDays,
  loadRegistry,
  mergeEntries,
  readTtls,
  registryPath,
  saveRegistry,
  transactionFootprint,
  type EntryRegistry,
  type TrackedEntry,
  type TtlRow,
} from './ledger'

/** Keys per extend or restore transaction. */
export const KEYS_PER_TX = 20

function contractIds(o: OpsContext): Record<ContractName, string> {
  return {
    core: contractId(o, 'core'),
    tab: contractId(o, 'tab'),
    nft: contractId(o, 'nft'),
  }
}

/** First ledger of the set: its earliest recorded deploy transaction. */
function firstLedger(o: OpsContext): number {
  const ledgers = CONTRACTS.map((c) => o.state.contracts?.[c]?.tx?.ledger)
    .concat(CONTRACTS.map((c) => o.state.uploads?.[c]?.tx?.ledger))
    .filter((l): l is number => typeof l === 'number')
  return ledgers.length ? Math.min(...ledgers) : 1
}

/**
 * Updates `<set>/ledger-entries.json`: deployment entries, then entries from
 * the footprints of transactions found since the last scan, then entries
 * from `--entries-file`. Returns the registry and notes for the report.
 */
export async function refreshRegistry(
  o: OpsContext,
  options: { scan: boolean; entriesFile?: string }
): Promise<{ registry: EntryRegistry; notes: string[] }> {
  const path = registryPath(o.setDir)
  const registry = loadRegistry(path)
  const notes: string[] = []
  const ids = contractIds(o)
  mergeEntries(registry, deploymentEntries(o.state))

  if (options.scan) {
    const { latestLedger, oldestLedger } = await health(o.net)
    // A ledger sequence below the scanned one means the network was reset.
    if (registry.scannedToLedger > latestLedger) {
      throw new Error(
        `The registry was scanned to ledger ${registry.scannedToLedger}, but the network is at ${latestLedger}. The network was reset; run redeploy-v2-testnet.ts.`
      )
    }
    const hashes = new Set<string>()
    if (registry.scannedToLedger === 0) {
      for (const h of deploymentTxHashes(o.state)) hashes.add(h)
    }
    let from = Math.max(registry.scannedToLedger + 1, firstLedger(o))
    if (from < oldestLedger) {
      notes.push(
        `Ledgers ${from} to ${oldestLedger - 1} are outside RPC retention. Entries first written there and not in the registry are not tracked; add them with --entries-file.`
      )
      from = oldestLedger
    }
    const scan = await eventTxHashes(o.net, Object.values(ids), from)
    for (const h of scan.hashes) hashes.add(h)
    let missing = 0
    let added = 0
    for (const hash of hashes) {
      const keys = await transactionFootprint(o.net, hash)
      if (!keys) {
        missing++
        continue
      }
      added += mergeEntries(
        registry,
        entriesFromFootprint(keys, ids, o.state.nativeSac)
      )
    }
    registry.scannedToLedger = scan.toLedger
    o.log(
      `scan: ledgers ${from} to ${scan.toLedger}, ${hashes.size} transactions, ${added} new entries`
    )
    if (missing > 0)
      notes.push(
        `${missing} transactions are no longer held by RPC; their entries are tracked only if an earlier scan recorded them.`
      )
  }
  if (options.entriesFile) {
    const added = mergeEntries(
      registry,
      entriesFromFile(readFileSync(options.entriesFile, 'utf8'), ids)
    )
    o.log(`entries file: ${added} new entries`)
  }
  saveRegistry(path, registry)
  return { registry, notes }
}

export type TtlReport = {
  at: string
  set: string
  network: string
  latestLedger: number
  thresholdLedgers: number
  rows: {
    label: string
    kind: string
    owner: string
    liveUntil: number | null
    remainingLedgers: number | null
    remainingDays: string | null
    status: string
    ledgerKey: string
  }[]
}

const ORDER = { archived: 0, due: 1, absent: 2, ok: 3 }

/** Prints the report and writes it to `<set>/ttl-report.json`. */
export function printReport(
  o: OpsContext,
  latestLedger: number,
  rows: TtlRow[],
  thresholdLedgers: number,
  notes: string[]
): TtlReport {
  const sorted = [...rows].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.remaining ?? 0) - (b.remaining ?? 0) ||
      a.entry.label.localeCompare(b.entry.label)
  )
  const report: TtlReport = {
    at: new Date().toISOString(),
    set: o.args.set,
    network: o.net.network,
    latestLedger,
    thresholdLedgers,
    rows: sorted.map((r) => ({
      label: r.entry.label,
      kind: r.entry.kind,
      owner: r.entry.owner,
      liveUntil: r.liveUntil,
      remainingLedgers: r.status === 'archived' ? null : r.remaining,
      remainingDays:
        r.remaining === null || r.status === 'archived'
          ? null
          : ledgersToDays(r.remaining),
      status: r.status,
      ledgerKey: r.entry.ledgerKey,
    })),
  }
  console.log(
    `\nTTL report: ${o.args.set} set on ${o.net.network}, ledger ${latestLedger}, ${rows.length} entries, threshold ${thresholdLedgers} ledgers (${ledgersToDays(thresholdLedgers)} days)\n`
  )
  console.log(
    table(
      ['status', 'entry', 'live until', 'ledgers left', 'days left'],
      report.rows.map((r) => [
        r.status,
        r.label,
        r.liveUntil === null ? '-' : String(r.liveUntil),
        r.remainingLedgers === null ? '-' : String(r.remainingLedgers),
        r.remainingDays ?? '-',
      ])
    )
  )
  const counts = Object.keys(ORDER)
    .map((s) => `${s} ${rows.filter((r) => r.status === s).length}`)
    .join(', ')
  console.log(
    `\n${counts}. Days assume 5 seconds per ledger. An absent entry is not in the ledger: the contract removed it (a claimed balance, for example) or it never existed.`
  )
  for (const note of notes) console.log(`note: ${note}`)
  writeFileSync(
    join(o.setDir, 'ttl-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 }
  )
  return report
}

export type PlannedTx = {
  action: 'extend' | 'restore'
  label: string
  entries: TrackedEntry[]
  args: string[]
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

/**
 * Groups entries into CLI transactions: one per Wasm code entry, and up to
 * KEYS_PER_TX data or instance keys per contract.
 */
export function planTransactions(
  action: 'extend' | 'restore',
  entries: TrackedEntry[],
  ledgers: number,
  source: string
): PlannedTx[] {
  const plans: PlannedTx[] = []
  const tail = ['--ledgers-to-extend', String(ledgers), '--source', source]
  for (const e of entries.filter((e) => e.kind === 'code')) {
    plans.push({
      action,
      label: e.label,
      entries: [e],
      args: ['contract', action, '--wasm-hash', e.wasmHash!, ...tail],
    })
  }
  const byContract = new Map<string, TrackedEntry[]>()
  for (const e of entries.filter((e) => e.kind !== 'code')) {
    const list = byContract.get(e.contractId!) ?? []
    list.push(e)
    byContract.set(e.contractId!, list)
  }
  for (const [id, list] of byContract) {
    for (const part of chunk(list, KEYS_PER_TX)) {
      plans.push({
        action,
        label: `${part[0]!.owner}: ${part.length} entr${part.length === 1 ? 'y' : 'ies'}`,
        entries: part,
        args: [
          'contract',
          action,
          '--id',
          id,
          ...part.flatMap((e) => ['--key-xdr', e.keyXdr!]),
          '--durability',
          'persistent',
          ...tail,
        ],
      })
    }
  }
  return plans
}

/** Prints the guarded CLI command of each planned transaction. */
export function printPlan(o: OpsContext, plans: PlannedTx[]): void {
  for (const plan of plans) {
    const { command, args } = cliCommand(o.ctx, plan.args)
    o.log(`${plan.action} ${plan.label}`)
    for (const e of plan.entries) o.log(`  - ${e.label}`)
    console.log(`    ${shellLine(command, args)}`)
  }
}

/** Extension target in ledgers, capped below the network maximum. */
export function extendLedgers(days: number, maxEntryTtl: number): number {
  return Math.min(Math.round(days * 17_280), maxEntryTtl - 1)
}

export async function currentRows(
  o: OpsContext,
  registry: EntryRegistry,
  thresholdLedgers: number
): Promise<{ latestLedger: number; rows: TtlRow[] }> {
  return readTtls(o.net, registry.entries, thresholdLedgers)
}
