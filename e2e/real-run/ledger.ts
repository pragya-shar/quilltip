/**
 * Read-only ledger snapshots for the real run: the Convex rows behind the
 * two screens (through the Convex CLI for `.env.local`'s target) and the
 * on-chain figures (Tab `account` and `claimable` by simulation). Nothing
 * here writes.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk'

const ROOT = path.resolve(import.meta.dirname, '../..')
const RPC = 'https://soroban-testnet.stellar.org'
const VIEW_SOURCE = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'

export function table<T = Record<string, unknown>>(
  name: string,
  limit = 500
): T[] {
  const out = spawnSync(
    'npx',
    ['convex', 'data', name, '--format', 'jsonl', '--limit', String(limit)],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (out.status !== 0) throw new Error(`convex data ${name} failed`)
  return out.stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l) as T)
}

async function view(tab: string, method: string, ...args: unknown[]) {
  const server = new rpc.Server(RPC)
  const tx = new TransactionBuilder(new Account(VIEW_SOURCE, '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(tab).call(
        method,
        ...args.map((a) => new Address(a as string).toScVal())
      )
    )
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result)
    throw new Error(`${method}: simulation failed`)
  return scValToNative(sim.result.retval) as unknown
}

export async function chainFigures(
  tab: string,
  reader: string,
  writer: string
) {
  const server = new rpc.Server(RPC)
  const latest = await server.getLatestLedger()
  const account = (await view(tab, 'account', reader)) as {
    balance?: bigint
  } | null
  const claimable = (await view(tab, 'claimable', writer)) as bigint
  return {
    ledger: latest.sequence,
    readerTabBalance: account?.balance?.toString() ?? null,
    writerClaimable: claimable.toString(),
  }
}

/** The rows behind both screens for one reader and one writer. */
export function convexRows(readerAddress: string, writerUserId: string | null) {
  const accounts = table<{ _id: string; readerAddress: string }>('tabAccounts')
  const account = accounts.find((a) => a.readerAddress === readerAddress)
  const receipts = account
    ? table<{ tabAccountId: string }>('tabReceipts', 1000).filter(
        (r) => r.tabAccountId === account._id
      )
    : []
  const vouchers = account
    ? table<{ tabAccountId: string }>('tabVouchers', 1000).filter(
        (v) => v.tabAccountId === account._id
      )
    : []
  const earnings = writerUserId
    ? table<{ userId: string }>('authorEarnings', 1000).find(
        (e) => e.userId === writerUserId
      )
    : undefined
  const settlements = table('tabSettlements', 50)
  return { account, receipts, vouchers, earnings, settlements }
}
