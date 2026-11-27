/**
 * Role and pause report for a v2 contract set, and guarded pause, unpause,
 * grant and revoke commands
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.11).
 *
 *   bun scripts/contracts/roles-v2-testnet.ts --set integration --keys-dir <dir>
 *   bun scripts/contracts/roles-v2-testnet.ts ... --action pause --contracts core [--submit]
 *   bun scripts/contracts/roles-v2-testnet.ts ... --action grant --role settler \
 *     --account G... --contracts tab [--submit]
 *
 * - Guarded by `assertScriptStellarTestnetOnly`; mainnet is refused in every
 *   form. Each submission first confirms the RPC server's passphrase.
 * - Without `--action` it only reads: admin, pause state and role holders of
 *   each contract, compared with the keys recorded at deployment.
 * - With `--action` it is a dry run unless `--submit` is given.
 * - Signers follow the contracts: `pause` by the pauser, `unpause` by the
 *   admin, `grant` and `revoke` by the admin, except the `upgrader` role,
 *   which only an upgrader grants or revokes.
 * - Idempotent: an action whose result is already in place is skipped.
 *   Revoking the last `upgrader` is refused, because nobody could grant it
 *   again.
 */
import { StrKey } from '@stellar/stellar-sdk'

import {
  CONTRACT_ROLES,
  ROLE_SYMBOLS,
  type ContractName,
} from './deploy-v2/config'
import { cliCommand, submit, view } from './deploy-v2/network'
import {
  appendOpsLog,
  contractId,
  contractsOption,
  opsContext,
  parseOpsArgs,
  shellLine,
  table,
  type OpsContext,
  type ParsedArgs,
} from './ops-v2/common'

export const OPERATION = 'roles-v2-testnet'

export const ACTIONS = ['pause', 'unpause', 'grant', 'revoke'] as const
export type Action = (typeof ACTIONS)[number]
export const ROLES = Object.values(ROLE_SYMBOLS)

export const USAGE = `Usage: bun scripts/contracts/roles-v2-testnet.ts --set integration|live|v3 --keys-dir <dir> [options]

  --contracts <list>    core,tab,nft subset (default: all)
  --action <name>       pause | unpause | grant | revoke (default: report only)
  --role <role>         pauser | upgrader | settler (grant and revoke)
  --account <G...>      Account to grant or revoke (grant and revoke)
  --submit              Send the transactions (default: dry run)
  --state-file <path>   Default: <keys-dir>/<set>/deploy-state.json`

export type RolesOptions = ParsedArgs & {
  contracts: ContractName[]
  action?: Action
  role?: string
  account?: string
}

export function parseArgs(argv: string[]): RolesOptions {
  const args = parseOpsArgs(argv, {
    usage: USAGE,
    values: ['contracts', 'action', 'role', 'account'],
  })
  const action = args.values.get('action')
  if (action && !(ACTIONS as readonly string[]).includes(action))
    throw new Error(`--action must be one of ${ACTIONS.join(', ')}\n${USAGE}`)
  const role = args.values.get('role')
  const account = args.values.get('account')
  if (action === 'grant' || action === 'revoke') {
    if (!role || !ROLES.includes(role as (typeof ROLES)[number]))
      throw new Error(`--role must be one of ${ROLES.join(', ')}\n${USAGE}`)
    if (!account || !StrKey.isValidEd25519PublicKey(account))
      throw new Error(`--account must be a G address\n${USAGE}`)
  } else if (role || account) {
    throw new Error(
      `--role and --account apply to grant and revoke only\n${USAGE}`
    )
  }
  if (args.submit && !action)
    throw new Error(`--submit needs an --action\n${USAGE}`)
  return {
    ...args,
    contracts: contractsOption(args),
    action: action as Action | undefined,
    role,
    account,
  }
}

type ContractRoles = {
  contract: ContractName
  id: string
  admin: string | null
  paused: boolean
  roles: Record<string, string[]>
}

function readRoles(o: OpsContext, c: ContractName): ContractRoles {
  const id = contractId(o, c)
  const src = o.identity('deployer')
  const v = <T>(fn: string, args: string[] = []) =>
    view<T>(o.ctx, id, src, fn, args)
  const roles: Record<string, string[]> = {}
  for (const role of ROLES) {
    const count = v<number>('get_role_member_count', ['--role', role]) ?? 0
    roles[role] = []
    for (let i = 0; i < count; i++) {
      roles[role]!.push(
        v<string>('get_role_member', ['--role', role, '--index', String(i)])
      )
    }
  }
  return {
    contract: c,
    id,
    admin: v<string | null>('get_admin'),
    paused: v<boolean>('paused'),
    roles,
  }
}

/** Expected holders from the deployment state. */
function expectedHolders(
  o: OpsContext,
  c: ContractName
): Record<string, string[]> {
  const keys = o.state.keys ?? {}
  const expected: Record<string, string[]> = {}
  for (const role of ROLES) expected[role] = []
  for (const role of CONTRACT_ROLES[c]) {
    const holder = keys[role]
    if (holder) expected[ROLE_SYMBOLS[role]] = [holder]
  }
  return expected
}

function printRoles(o: OpsContext, all: ContractRoles[]): number {
  const rows: string[][] = []
  let mismatches = 0
  for (const r of all) {
    const expectedAdmin = o.state.keys?.admin ?? '?'
    const adminOk = r.admin === expectedAdmin
    rows.push([
      r.contract,
      'admin',
      r.admin ?? '(none)',
      adminOk ? 'yes' : 'NO',
    ])
    rows.push([r.contract, 'paused', String(r.paused), r.paused ? 'NO' : 'yes'])
    if (!adminOk) mismatches++
    if (r.paused) mismatches++
    const expected = expectedHolders(o, r.contract)
    for (const role of ROLES) {
      const holders = r.roles[role] ?? []
      const ok =
        [...holders].sort().join(',') ===
        [...(expected[role] ?? [])].sort().join(',')
      if (!ok) mismatches++
      rows.push([
        r.contract,
        role,
        holders.length ? holders.join(', ') : '(none)',
        ok ? 'yes' : 'NO',
      ])
    }
  }
  console.log(
    `\nRoles: ${o.args.set} set on ${o.net.network}. "as deployed" compares with the keys recorded at deployment; a paused contract is reported as a difference.\n`
  )
  console.log(table(['contract', 'item', 'value', 'as deployed'], rows))
  console.log('')
  return mismatches
}

type Planned = { contract: ContractName; args: string[]; label: string }

/** The transactions an action needs, skipping those already in effect. */
export function planAction(
  o: OpsContext,
  current: ContractRoles[],
  options: Pick<RolesOptions, 'action' | 'role' | 'account'>
): Planned[] {
  const keys = o.state.keys ?? {}
  const need = (name: string) => {
    const value = keys[name]
    if (!value) throw new Error(`The deployment state has no ${name} key.`)
    return value
  }
  const plans: Planned[] = []
  for (const r of current) {
    const invoke = (signer: string, fn: string, args: string[]) => [
      'contract',
      'invoke',
      '--id',
      r.id,
      '--source',
      o.identity(signer),
      '--',
      fn,
      ...args,
    ]
    switch (options.action) {
      case 'pause':
        if (r.paused) {
          o.log(`${r.contract}: already paused; skipped`)
          break
        }
        plans.push({
          contract: r.contract,
          label: `pause ${r.contract}`,
          args: invoke('pauser', 'pause', ['--caller', need('pauser')]),
        })
        break
      case 'unpause':
        if (!r.paused) {
          o.log(`${r.contract}: not paused; skipped`)
          break
        }
        plans.push({
          contract: r.contract,
          label: `unpause ${r.contract}`,
          args: invoke('admin', 'unpause', ['--caller', need('admin')]),
        })
        break
      case 'grant':
      case 'revoke': {
        const role = options.role!
        const account = options.account!
        const holders = r.roles[role] ?? []
        const has = holders.includes(account)
        if (options.action === 'grant' && has) {
          o.log(`${r.contract}: ${account} already holds ${role}; skipped`)
          break
        }
        if (options.action === 'revoke' && !has) {
          o.log(`${r.contract}: ${account} does not hold ${role}; skipped`)
          break
        }
        if (
          options.action === 'revoke' &&
          role === 'upgrader' &&
          holders.length === 1
        ) {
          throw new Error(
            `${r.contract}: ${account} is the only upgrader. Grant upgrader to another account first; nobody else can grant it.`
          )
        }
        const signer = role === 'upgrader' ? 'upgrader' : 'admin'
        const fn = options.action === 'grant' ? 'grant_role' : 'revoke_role'
        plans.push({
          contract: r.contract,
          label: `${options.action} ${role} ${account} on ${r.contract}`,
          args: invoke(signer, fn, [
            '--account',
            account,
            '--role',
            role,
            '--caller',
            need(signer),
          ]),
        })
        break
      }
    }
  }
  return plans
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  const options = parseArgs(argv)
  const o = opsContext(OPERATION, options, env)
  o.log(
    `network ${o.net.network}, RPC ${o.net.rpcUrl}, passphrase "${o.net.passphrase}"`
  )
  const current = options.contracts.map((c) => readRoles(o, c))
  const mismatches = printRoles(o, current)
  if (!options.action) return mismatches > 0 ? 4 : 0

  const plans = planAction(o, current, options)
  if (plans.length === 0) {
    o.log('nothing to do')
    return 0
  }
  for (const plan of plans) {
    const { command, args } = cliCommand(o.ctx, plan.args)
    o.log(plan.label)
    console.log(`    ${shellLine(command, args)}`)
  }
  if (!options.submit) {
    o.log(
      'dry run: nothing was submitted. Add --submit to send these transactions.'
    )
    return 0
  }
  for (const plan of plans) {
    const result = await submit(o.ctx, plan.args)
    appendOpsLog(o, {
      at: new Date().toISOString(),
      operation: OPERATION,
      network: o.net.network,
      action: plan.label,
      tx: result.tx,
    })
    o.log(
      `${plan.label}: tx ${result.tx.hash} (ledger ${result.tx.ledger}, fee ${result.tx.feeCharged} stroops)`
    )
  }
  printRoles(
    o,
    options.contracts.map((c) => readRoles(o, c))
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
