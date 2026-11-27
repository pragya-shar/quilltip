/**
 * Restores archived ledger entries of a v2 contract set and extends them
 * (docs/architecture/v2/07-security-and-recovery.md, section 7.4).
 *
 *   bun scripts/contracts/restore-v2-testnet.ts --set integration \
 *     --keys-dir <directory outside the repo> [--submit]
 *
 * - Guarded by `assertScriptStellarTestnetOnly`; mainnet is refused in every
 *   form. Each submission first confirms the RPC server's passphrase.
 * - A dry run by default: it lists the archived entries and the CLI commands
 *   it would run. `--submit` sends them.
 * - Uses the entries tracked by extend-v2-testnet.ts
 *   (`<keys-dir>/<set>/ledger-entries.json`) and scans for new ones first.
 *   `--entries-file` adds keys that no scan can find.
 * - Only archived entries are restored. Restoring a live or removed entry
 *   would be a fee-paying no-op, so a rerun after a restore sends nothing.
 * - Prepared app transactions already restore the entries they touch; this
 *   script is for large footprints and for entries nothing touches.
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

export const OPERATION = 'restore-v2-testnet'

export const USAGE = `Usage: bun scripts/contracts/restore-v2-testnet.ts --set integration|live|v3 --keys-dir <dir> [options]

  --submit              Send the restore transactions (default: dry run)
  --extend-days <n>     After restoring, extend to this many days (default: 120,
                        capped below the network maximum)
  --entries-file <path> JSON array of extra { contract, keyXdr } entries
  --no-scan             Do not scan events for new entries
  --state-file <path>   Default: <keys-dir>/<set>/deploy-state.json`

export function parseArgs(argv: string[]): ParsedArgs {
  return parseOpsArgs(argv, {
    usage: USAGE,
    values: ['extend-days', 'entries-file'],
    flags: ['no-scan'],
  })
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  const args = parseArgs(argv)
  const extendDays = numberOption(args, 'extend-days', 120)
  const o = opsContext(OPERATION, args, env)
  o.log(
    `network ${o.net.network}, RPC ${o.net.rpcUrl}, passphrase "${o.net.passphrase}"`
  )

  const settings = await archivalSettings(o.net)
  const ledgers = extendLedgers(extendDays, settings.maxEntryTtl)
  const { registry, notes } = await refreshRegistry(o, {
    scan: !args.flags.has('no-scan'),
    entriesFile: args.values.get('entries-file'),
  })
  const { latestLedger, rows } = await currentRows(o, registry, 0)
  printReport(o, latestLedger, rows, 0, notes)

  const archived = rows
    .filter((r) => r.status === 'archived')
    .map((r) => r.entry)
  const plans = planTransactions(
    'restore',
    archived,
    ledgers,
    o.identity('deployer')
  )
  if (plans.length === 0) {
    o.log('no archived entries; nothing to restore')
    return 0
  }
  o.log(
    `${archived.length} archived entries to restore and extend to ${ledgers} ledgers (${ledgersToDays(ledgers)} days) in ${plans.length} transactions`
  )
  printPlan(o, plans)
  if (!args.submit) {
    o.log(
      'dry run: nothing was submitted. Add --submit to send these transactions.'
    )
    return 3
  }

  for (const plan of plans) {
    const result = await submit(o.ctx, plan.args)
    appendOpsLog(o, {
      at: new Date().toISOString(),
      operation: OPERATION,
      network: o.net.network,
      action: `restore ${plan.label}`,
      tx: result.tx,
      detail: plan.entries.map((e) => e.label).join('; '),
    })
    o.log(
      `restored ${plan.label}: tx ${result.tx.hash} (ledger ${result.tx.ledger}, fee ${result.tx.feeCharged} stroops)`
    )
  }
  const after = await currentRows(o, registry, 0)
  const restored = new Set(archived.map((e) => e.ledgerKey))
  let still = 0
  for (const row of after.rows.filter((r) => restored.has(r.entry.ledgerKey))) {
    if (row.status === 'archived') still++
    o.log(
      `after: ${row.entry.label} ${row.status}, live until ${row.liveUntil ?? '-'}`
    )
  }
  if (still > 0) {
    o.log(`${still} entries are still archived; see the transactions above.`)
    return 3
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
