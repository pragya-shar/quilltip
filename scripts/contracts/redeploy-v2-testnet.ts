/**
 * Redeploys a v2 contract set after a testnet reset, from the commit and
 * configuration recorded at its deployment
 * (docs/architecture/v2/07-security-and-recovery.md, section 7.4, "Testnet
 * reset"; 08-testing-and-deployment.md, section 8.4).
 *
 *   bun scripts/contracts/redeploy-v2-testnet.ts --set integration \
 *     --keys-dir <directory outside the repo> [--submit]
 *
 * - Guarded by `assertScriptStellarTestnetOnly`; mainnet is refused in every
 *   form. Each submission first confirms the RPC server's passphrase.
 * - Detects the reset first: the ledger sequence is below the recorded
 *   deployment ledgers, or none of the three contract instances exists. It
 *   refuses when the contracts are still there (archived entries need
 *   restore-v2-testnet.ts, not a redeploy).
 * - A dry run by default: it prints the recorded commit, Wasm hashes and
 *   configuration it will reuse, and the contract IDs it will create.
 * - `--submit` keeps the old state and entry registry as
 *   `*.before-reset-<date>.json`, then runs the deployment tool's steps
 *   (keys, upload, deploy, verify, smoke, evidence) with the recorded commit.
 *   Keys are reused and funded again. The evidence document is regenerated.
 * - Resumable: after an interrupted run, run it again; the deployment steps
 *   skip what the new state records.
 * - It touches no Convex deployment. It prints the values to set there.
 */
import { createHash } from 'crypto'
import { copyFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { Contract } from '@stellar/stellar-sdk'

import { CONTRACTS, WASM_FILES, type ContractName } from './deploy-v2/config'
import { cli, latestLedger, rpc } from './deploy-v2/network'
import { saveState, type DeployState } from './deploy-v2/state'
import { deploySalt } from './deploy-v2/steps'
import { main as deployMain } from './deploy-v2-testnet'
import {
  opsContext,
  parseOpsArgs,
  table,
  type OpsContext,
  type ParsedArgs,
} from './ops-v2/common'

export const OPERATION = 'redeploy-v2-testnet'

export const USAGE = `Usage: bun scripts/contracts/redeploy-v2-testnet.ts --set integration|live|v3 --keys-dir <dir> [options]

  --submit              Redeploy (default: dry run)
  --evidence <path>     Passed to the deployment tool (default: its default)
  --base-ref <ref>      A testnet commit must be on this ref (default: the set's branch)
  --state-file <path>   Default: <keys-dir>/<set>/deploy-state.json`

export function parseArgs(argv: string[]): ParsedArgs {
  return parseOpsArgs(argv, {
    usage: USAGE,
    values: ['evidence', 'base-ref'],
  })
}

/** Highest ledger recorded in the state: the network had reached it. */
export function recordedLedger(state: DeployState): number {
  const ledgers = [
    ...Object.values(state.uploads ?? {}).map((u) => u?.tx?.ledger),
    ...Object.values(state.contracts ?? {}).map((c) => c?.tx?.ledger),
    ...Object.values(state.smoke ?? {}).map((s) => s?.tx?.ledger),
  ].filter((l): l is number => typeof l === 'number')
  return ledgers.length ? Math.max(...ledgers) : 0
}

export type ResetCheck = {
  latest: number
  recorded: number
  ledgerDropped: boolean
  instances: Record<ContractName, boolean>
  reset: boolean
  reason: string
}

/** Decides from the ledger sequence and the three instances. */
export function decideReset(
  latest: number,
  recorded: number,
  instances: Record<ContractName, boolean>
): ResetCheck {
  const ledgerDropped = recorded > 0 && latest < recorded
  const present = CONTRACTS.filter((c) => instances[c])
  let reason: string
  let reset: boolean
  if (ledgerDropped) {
    reset = true
    reason = `the ledger sequence dropped from ${recorded} to ${latest}`
  } else if (present.length === 0) {
    // A reset always restarts the ledger sequence. Without that, missing
    // instances point to wrong IDs, a wrong RPC server or archived state, and
    // a redeploy would replace a deployment that may still exist.
    reset = false
    reason = `none of the three contract instances was found, but the ledger sequence did not drop (${latest} >= ${recorded}). This is not a reset. Check the contract IDs, the RPC server and the TTL report before deploying anything.`
  } else if (present.length < CONTRACTS.length) {
    reset = false
    reason = `only ${present.join(', ')} exist; a partial loss is not a reset. Check the IDs and the network before deploying anything.`
  } else {
    reset = false
    reason =
      'all three contract instances exist; archived entries need restore-v2-testnet.ts, not a redeploy'
  }
  return { latest, recorded, ledgerDropped, instances, reset, reason }
}

async function instanceExists(o: OpsContext, id: string): Promise<boolean> {
  const key = new Contract(id).getFootprint().toXDR('base64')
  const result = await rpc<{ entries?: unknown[] }>(o.net, 'getLedgerEntries', {
    keys: [key],
  })
  return (result.entries?.length ?? 0) > 0
}

/** Recorded build, kept only while its Wasm files still have the recorded hashes. */
function reusableBuild(state: DeployState): DeployState['build'] {
  const build = state.build
  if (!build) return undefined
  for (const c of CONTRACTS) {
    const path = join(build.outDir, WASM_FILES[c])
    if (!existsSync(path)) return undefined
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (sha !== build.wasm[c].sha256) return undefined
  }
  return build
}

function keepAside(path: string, tag: string): string | null {
  if (!existsSync(path)) return null
  const target = path.replace(/\.json$/, `.${tag}.json`)
  if (existsSync(target)) throw new Error(`${target} already exists.`)
  copyFileSync(path, target)
  return target
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  const args = parseArgs(argv)
  const o = opsContext(OPERATION, args, env)
  o.log(
    `network ${o.net.network}, RPC ${o.net.rpcUrl}, passphrase "${o.net.passphrase}"`
  )
  const old = o.state
  if (!old.commit || !old.build || !old.config) {
    throw new Error(
      `${o.statePath} records no commit, build or configuration to reuse.`
    )
  }

  const instances = {} as Record<ContractName, boolean>
  for (const c of CONTRACTS) {
    instances[c] = await instanceExists(o, old.contracts![c]!.id)
  }
  const check = decideReset(
    await latestLedger(o.net),
    recordedLedger(old),
    instances
  )
  o.log(
    `ledger ${check.latest}, highest recorded ${check.recorded}; instances: ${CONTRACTS.map((c) => `${c} ${instances[c] ? 'present' : 'absent'}`).join(', ')}`
  )
  if (!check.reset) {
    o.log(`no reset detected: ${check.reason}. Nothing to redeploy.`)
    return 0
  }
  o.log(`reset detected: ${check.reason}`)

  const build = reusableBuild(old)
  const expected = CONTRACTS.map((c) => {
    const salt = deploySalt(o.args.set, c, old.commit!)
    const id = cli(o.ctx, [
      'contract',
      'id',
      'wasm',
      '--salt',
      salt,
      '--source',
      o.identity('deployer'),
    ]).stdout
    return [c, old.contracts![c]!.id, id]
  })
  console.log(`\nRedeploy plan for the ${o.args.set} set on ${o.net.network}\n`)
  console.log(
    table(
      ['item', 'value'],
      [
        ['commit', old.commit],
        [
          'build',
          build
            ? `reused (${build.outDir})`
            : 'rebuilt twice in the pinned container',
        ],
        ...CONTRACTS.map((c) => [`${c} Wasm`, old.build!.wasm[c].sha256]),
        ['NFT base URI', old.config.nftBaseUri],
        ['keys', `reused from ${o.setDir}; funded again by Friendbot`],
        ['steps', 'keys, upload, deploy, verify, smoke, evidence'],
      ]
    )
  )
  console.log('')
  console.log(table(['contract', 'before the reset', 'after'], expected))
  console.log('')
  if (!args.submit) {
    o.log('dry run: nothing was submitted. Add --submit to redeploy.')
    return 0
  }

  // The old state is copied aside; the entry registry and TTL report belong
  // to the old network, so they are moved aside. The operations log goes on.
  const tag = `before-reset-${new Date().toISOString().slice(0, 10)}`
  const keptState = keepAside(o.statePath, tag)
  if (keptState) o.log(`kept ${keptState}`)
  for (const name of ['ledger-entries.json', 'ttl-report.json']) {
    const path = join(o.setDir, name)
    const kept = keepAside(path, tag)
    if (kept) {
      rmSync(path)
      o.log(`moved ${path} to ${kept}`)
    }
  }
  const fresh: DeployState = {
    version: 1,
    set: old.set,
    network: old.network,
    passphrase: old.passphrase,
    commit: old.commit,
    ...(build ? { build } : {}),
    keys: old.keys,
    config: old.config,
  }
  saveState(o.statePath, fresh)
  o.log(`new state ${o.statePath}`)

  const deployArgs = [
    '--set',
    o.args.set,
    '--commit',
    old.commit,
    '--keys-dir',
    o.args.keysDir,
    '--state-file',
    o.statePath,
    '--steps',
    'build,keys,upload,deploy,verify,smoke,evidence',
    '--nft-base-uri',
    old.config.nftBaseUri,
    '--build-dir',
    resolve(old.build.outDir, '..'),
    ...(args.values.get('evidence')
      ? ['--evidence', args.values.get('evidence')!]
      : []),
    ...(args.values.get('base-ref')
      ? ['--base-ref', args.values.get('base-ref')!]
      : []),
  ]
  try {
    await deployMain(deployArgs, env)
  } catch (error) {
    // The old state is kept aside and the new one is partial, so this tool
    // no longer applies. The deployment tool resumes from the new state.
    console.error(
      `\nThe redeploy stopped. The state before the reset is kept aside, and ${o.statePath} holds the progress so far. Fix the cause, then resume with the deployment tool (it skips the steps already done):\n\n  bun scripts/contracts/deploy-v2-testnet.ts ${deployArgs.join(' ')}\n`
    )
    throw error
  }

  const now = JSON.parse(readFileSync(o.statePath, 'utf8')) as DeployState
  const coreLedger = now.contracts?.core?.tx?.ledger
  console.log(
    `\nRedeployed the ${o.args.set} set. Values for the Convex deployment of this set:\n`
  )
  console.log(
    table(
      ['name', 'value'],
      [
        ['CORE_CONTRACT_ID', now.contracts?.core?.id ?? '-'],
        ['TAB_CONTRACT_ID', now.contracts?.tab?.id ?? '-'],
        ['NFT_CONTRACT_ID', now.contracts?.nft?.id ?? '-'],
        ['TOKEN_CONTRACT_ID', now.nativeSac ?? '-'],
        ['INDEXER_START_LEDGER', coreLedger ? String(coreLedger) : '-'],
        [
          'CHAIN_EPOCH',
          `a new value, for example testnet-${new Date().toISOString().slice(0, 10)}`,
        ],
      ]
    )
  )
  console.log(
    `\nTAB_SETTLER_SECRET and TAB_ACCEPTOR_SECRET are unchanged (same keys). Follow docs/operations/chain-runbook.md, "Testnet reset", for the Convex steps.`
  )
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
