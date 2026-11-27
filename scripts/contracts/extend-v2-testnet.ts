/**
 * Reports the time to live of a v2 contract set's ledger entries and extends
 * the ones that are close to expiry
 * (docs/architecture/v2/07-security-and-recovery.md, section 7.4).
 *
 *   bun scripts/contracts/extend-v2-testnet.ts --set integration \
 *     --keys-dir <directory outside the repo> [--submit]
 *
 * - Guarded by `assertScriptStellarTestnetOnly`; mainnet is refused in every
 *   form. Each submission first confirms the RPC server's passphrase.
 * - A dry run by default: it prints the report and the CLI commands it would
 *   run. `--submit` sends them.
 * - Tracks instances, Wasm code and persistent entries (see ops-v2/ledger.ts)
 *   in `<keys-dir>/<set>/ledger-entries.json`; writes the report to
 *   `<keys-dir>/<set>/ttl-report.json` and each transaction to `ops-log.json`.
 * - Idempotent: an entry above the threshold is not extended again.
 * - Exit code 3 when an entry is archived (run restore-v2-testnet.ts).
 */
import {
  appendOpsLog,
  numberOption,
  opsContext,
  parseOpsArgs,
  type ParsedArgs,
} from './ops-v2/common'
import { archivalSettings, ledgersToDays } from './ops-v2/ledger'
import {
  currentRows,
  extendLedgers,
  planTransactions,
  printPlan,
  printReport,
  refreshRegistry,
} from './ops-v2/ttl'
import { submit } from './deploy-v2/network'

export const OPERATION = 'extend-v2-testnet'

export const USAGE = `Usage: bun scripts/contracts/extend-v2-testnet.ts --set integration|live|v3 --keys-dir <dir> [options]

  --submit              Send the extension transactions (default: dry run)
  --threshold-days <n>  Extend entries with fewer days left (default: 30)
  --extend-days <n>     Extend entries to this many days (default: 120,
                        capped below the network maximum)
  --all                 Extend every live entry, whatever its TTL
  --entries-file <path> JSON array of extra { contract, keyXdr } entries
  --no-scan             Do not scan events for new entries
  --state-file <path>   Default: <keys-dir>/<set>/deploy-state.json`

export function parseArgs(argv: string[]): ParsedArgs {
  return parseOpsArgs(argv, {
    usage: USAGE,
    values: ['threshold-days', 'extend-days', 'entries-file'],
    flags: ['all', 'no-scan'],
  })
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  const args = parseArgs(argv)
  const thresholdDays = numberOption(args, 'threshold-days', 30)
  const extendDays = numberOption(args, 'extend-days', 120)
  const o = opsContext(OPERATION, args, env)
  o.log(
    `network ${o.net.network}, RPC ${o.net.rpcUrl}, passphrase "${o.net.passphrase}"`
  )

  const settings = await archivalSettings(o.net)
  const ledgers = extendLedgers(extendDays, settings.maxEntryTtl)
  const threshold = Math.min(Math.round(thresholdDays * 17_280), ledgers)
  const { registry, notes } = await refreshRegistry(o, {
    scan: !args.flags.has('no-scan'),
    entriesFile: args.values.get('entries-file'),
  })
  const { latestLedger, rows } = await currentRows(o, registry, threshold)
  printReport(o, latestLedger, rows, threshold, notes)

  const targets = rows
    .filter((r) =>
      args.flags.has('all')
        ? r.status === 'ok' || r.status === 'due'
        : r.status === 'due'
    )
    .map((r) => r.entry)
  const unavailable = rows.filter((r) => r.status === 'archived')
  if (unavailable.length > 0) {
    o.log(
      `${unavailable.length} entries are archived; run restore-v2-testnet.ts for them.`
    )
  }
  const plans = planTransactions(
    'extend',
    targets,
    ledgers,
    o.identity('deployer')
  )
  if (plans.length === 0) {
    o.log('nothing to extend')
    return unavailable.length > 0 ? 3 : 0
  }
  o.log(
    `${targets.length} entries to extend to ${ledgers} ledgers (${ledgersToDays(ledgers)} days) in ${plans.length} transactions`
  )
  printPlan(o, plans)
  if (!args.submit) {
    o.log(
      'dry run: nothing was submitted. Add --submit to send these transactions.'
    )
    return unavailable.length > 0 ? 3 : 0
  }

  for (const plan of plans) {
    const result = await submit(o.ctx, plan.args)
    appendOpsLog(o, {
      at: new Date().toISOString(),
      operation: OPERATION,
      network: o.net.network,
      action: `extend ${plan.label}`,
      tx: result.tx,
      detail: plan.entries.map((e) => e.label).join('; '),
    })
    o.log(
      `extended ${plan.label}: tx ${result.tx.hash} (ledger ${result.tx.ledger}, fee ${result.tx.feeCharged} stroops)`
    )
  }
  const after = await currentRows(o, registry, threshold)
  const extended = new Set(targets.map((t) => t.ledgerKey))
  for (const row of after.rows.filter((r) => extended.has(r.entry.ledgerKey))) {
    o.log(
      `after: ${row.entry.label} live until ${row.liveUntil} (${row.remaining === null ? '-' : ledgersToDays(row.remaining)} days)`
    )
  }
  return unavailable.length > 0 ? 3 : 0
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
