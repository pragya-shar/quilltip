/**
 * Settlement reserves whose `TabSettled` event was never indexed
 * (05-flows-and-admin.md, section 5.6; 07-security-and-recovery.md, I-22;
 * docs/operations/chain-runbook.md, "Stale settlement reserves").
 *
 * A settled amount stays reserved (`tabAccounts.settledUnindexed`) until its
 * event debits `confirmedBalance`. If the event is lost (an indexer gap
 * beyond RPC retention, a restore), an absolute balance from a later ledger
 * usually releases it (`releaseIncludedReserves`). For the rest an operator
 * reconciles the account against the contract:
 *
 * 1. `snapshot` records the account and its pairs.
 * 2. `run` reads the contract's `account(reader)` balance and
 *    `paid(reader, key_id, writer)` for each pair, all at one ledger L.
 * 3. `reconcile` checks that nothing changed since the snapshot, that the
 *    indexer has applied every event up to L, and that the balance gap is
 *    explained by the missing paid ranges. It then applies the contract's
 *    balance as the absolute balance at the end of L and marks each pair's
 *    `[0, paid]` as indexed, which releases its reserve. A missing event
 *    that arrives later is older than that balance (no debit) and its range
 *    is already indexed (no release), so nothing is counted twice.
 *
 * Every function here is internal except the operations read, which is
 * limited to `OPS_USER_IDS`.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server'
import { readChainEnv, type ChainEnv } from '../lib/chain/env'
import { createBackendRpcClient, type RpcClient } from '../lib/chain/rpc'
import {
  applyPairSettlement,
  pairOutstanding,
  pairUnindexed,
  readerSpendable,
  recordReserveRelease,
  releasePairReserve,
  tabAccountForReader,
} from '../lib/chain/tabLedger'
import { opsUserIds } from './indexer'

const ZERO = BigInt(0)
const big = (value: string) => BigInt(value)

/** Any valid account works as the source of a view simulation. */
const VIEW_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

/** An hour: the operations check reports reserves older than this. */
export const STALE_RESERVE_MS = 60 * 60 * 1000

/**
 * An event id after every event of `ledger` and before every event of the
 * next ledger: the RPC id is the zero-padded TOID (`ledger << 32 | tx << 12
 * | op`, transactions numbered from 1) and an event index.
 */
export function endOfLedgerEventId(ledger: number): string {
  const toid = (BigInt(ledger) + BigInt(1)) << BigInt(32)
  return `${toid.toString().padStart(19, '0')}-0000000000`
}

type Pair = { keyId: number; writer: string }

const pairValidator = v.object({ keyId: v.number(), writer: v.string() })

function pairKey(p: Pair): string {
  return `${p.keyId}:${p.writer}`
}

async function accountVouchers(
  ctx: QueryCtx | MutationCtx,
  tabAccountId: Id<'tabAccounts'>
): Promise<Doc<'tabVouchers'>[]> {
  return ctx.db
    .query('tabVouchers')
    .withIndex('by_pair', (q) => q.eq('tabAccountId', tabAccountId))
    .collect()
}

/** The account and pair figures a reconciliation depends on. */
function stateDigest(
  account: Doc<'tabAccounts'>,
  vouchers: Doc<'tabVouchers'>[]
): string {
  return JSON.stringify({
    a: [
      account.status,
      account.confirmedBalance,
      account.outstanding,
      account.settledUnindexed ?? '0',
      account.balanceEventId ?? null,
      account.settledSinceBalance,
    ],
    v: vouchers
      .map((row) => [
        String(row._id),
        row.state,
        row.cumulative,
        row.paidOnChain,
        row.indexedPaid ?? null,
      ])
      .sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1)),
  })
}

/** Step 1: the account to reconcile, its pairs, and a digest of its state. */
export const snapshot = internalQuery({
  args: {
    reader: v.string(),
    keyId: v.optional(v.number()),
    writer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    const account = await tabAccountForReader(
      ctx,
      args.reader,
      chain.chainEpoch
    )
    if (!account) return null
    const vouchers = await accountVouchers(ctx, account._id)
    const scoped = vouchers.filter(
      (row) =>
        (args.keyId === undefined || row.keyId === args.keyId) &&
        (args.writer === undefined || row.writerAddress === args.writer)
    )
    return {
      tabAccountId: account._id,
      readerAddress: account.readerAddress,
      tabContractId: account.tabContractId,
      digest: stateDigest(account, vouchers),
      pairs: scoped.map((row) => ({
        keyId: row.keyId,
        writer: row.writerAddress,
      })),
    }
  },
})

export type ChainRead = {
  ledger: number
  balance: string
  paid: Array<Pair & { paid: string }>
}

async function viewAt(
  rpc: RpcClient,
  passphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<{ value: unknown; ledger: number }> {
  const tx = new TransactionBuilder(new Account(VIEW_SOURCE, '0'), {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build()
  const result = await rpc.simulateTransaction(tx.toXdr())
  if (result.error || !result.retvalXdr) {
    throw new Error(`${method}: ${result.error ?? 'no return value'}`)
  }
  return {
    value: scValToNative(xdr.ScVal.fromXdr(result.retvalXdr, 'base64')),
    ledger: result.latestLedger,
  }
}

/**
 * Step 2: the reader's balance and each pair's `paid`, read from the Tab
 * contract at one ledger. Reads that span ledgers are repeated; a reader
 * without an account on chain (after a withdrawal) has balance 0.
 */
export async function readTabChainState(
  rpc: RpcClient,
  chain: Pick<ChainEnv, 'passphrase'>,
  tabContractId: string,
  reader: string,
  pairs: Pair[],
  attempts = 3
): Promise<ChainRead> {
  const readerArg = new Address(reader).toScVal()
  for (let attempt = 0; attempt < attempts; attempt++) {
    const account = await viewAt(
      rpc,
      chain.passphrase,
      tabContractId,
      'account',
      [readerArg]
    )
    const paid: ChainRead['paid'] = []
    let ledger = account.ledger
    let sameLedger = true
    for (const p of pairs) {
      const read = await viewAt(rpc, chain.passphrase, tabContractId, 'paid', [
        readerArg,
        nativeToScVal(p.keyId, { type: 'u32' }),
        new Address(p.writer).toScVal(),
      ])
      if (read.ledger !== ledger) sameLedger = false
      ledger = Math.max(ledger, read.ledger)
      paid.push({ ...p, paid: BigInt(read.value as bigint).toString() })
    }
    if (!sameLedger) continue
    const value = account.value as { balance?: bigint } | null | undefined
    return {
      ledger,
      balance: BigInt(value?.balance ?? 0).toString(),
      paid,
    }
  }
  throw new Error('The chain moved during every read; try again.')
}

type Figures = {
  confirmedBalance: string
  outstanding: string
  settledUnindexed: string
  spendable: string
}

function figuresOf(
  a: Pick<
    Doc<'tabAccounts'>,
    'confirmedBalance' | 'outstanding' | 'settledUnindexed'
  >
): Figures {
  return {
    confirmedBalance: a.confirmedBalance,
    outstanding: a.outstanding,
    settledUnindexed: a.settledUnindexed ?? '0',
    spendable: readerSpendable(a).toString(),
  }
}

export type ReconcileResult =
  | {
      status: 'refused'
      reason:
        | 'NOT_FOUND'
        | 'CHANGED'
        | 'INDEXER_BEHIND'
        | 'EVENTS_UNHANDLED'
        | 'STALE_READ'
        | 'MISSING_READ'
        | 'MISMATCH_PAID'
        | 'BALANCE_MISMATCH'
      detail: string
    }
  | {
      status: 'nothing_to_do' | 'dry_run' | 'applied'
      ledger: number
      before: Figures
      after: Figures
      /** Paid amount marked as indexed per pair. */
      pairs: Array<
        Pair & { paidBefore: string; paidAfter: string; marked: string }
      >
    }

const refuse = (
  reason: Extract<ReconcileResult, { status: 'refused' }>['reason'],
  detail: string
): ReconcileResult => ({ status: 'refused', reason, detail })

/**
 * Step 3: checks the chain read against the stored state and, with
 * `apply`, releases the reserve the chain confirms. Without `apply` it is a
 * dry run and writes nothing. Running it again finds nothing to do.
 */
export const reconcile = internalMutation({
  args: {
    tabAccountId: v.id('tabAccounts'),
    digest: v.string(),
    pairs: v.array(pairValidator),
    chain: v.object({
      ledger: v.number(),
      balance: v.string(),
      paid: v.array(
        v.object({ keyId: v.number(), writer: v.string(), paid: v.string() })
      ),
    }),
    apply: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReconcileResult> => {
    const now = Date.now()
    const account = await ctx.db.get(args.tabAccountId)
    if (!account) return refuse('NOT_FOUND', 'No such tab account.')
    const vouchers = await accountVouchers(ctx, account._id)
    if (stateDigest(account, vouchers) !== args.digest) {
      return refuse('CHANGED', 'The account changed since the snapshot.')
    }
    const L = args.chain.ledger
    const cursor = await ctx.db
      .query('chainCursor')
      .withIndex('by_network', (q) => q.eq('network', account.network))
      .first()
    if (
      !cursor ||
      cursor.chainEpoch !== account.chainEpoch ||
      cursor.lastLedger < L
    ) {
      return refuse(
        'INDEXER_BEHIND',
        `The indexer has not applied ledger ${L} (cursor ${cursor?.lastLedger ?? 'none'}).`
      )
    }
    for (const handled of ['pending', 'error'] as const) {
      const rows = await ctx.db
        .query('chainEvents')
        .withIndex('by_handled', (q) => q.eq('handled', handled))
        .take(1000)
      const blocking = rows.find(
        (row) =>
          row.chainEpoch === account.chainEpoch &&
          row.contractId === account.tabContractId &&
          row.ledger <= L &&
          row.topics[1] === account.readerAddress
      )
      if (blocking) {
        return refuse(
          'EVENTS_UNHANDLED',
          `Event ${blocking.eventId} (${blocking.type}) is ${handled}; dispatch it first.`
        )
      }
    }
    const synthetic = endOfLedgerEventId(L)
    // The contract's balance at L replaces the stored one, so nothing the
    // stored balance holds may come from after L: neither its absolute
    // balance nor a `TabSettled` debit applied on top of it (a read from a
    // node that lags the indexer).
    if (
      (account.balanceLedger !== undefined && account.balanceLedger > L) ||
      (account.balanceEventId !== undefined &&
        account.balanceEventId > synthetic) ||
      account.settledSinceBalance.some((s) => s.eventId > synthetic)
    ) {
      return refuse(
        'STALE_READ',
        `The stored balance or a debit on it is from after ledger ${L}; read the chain again.`
      )
    }

    const byPair = new Map(
      vouchers.map((row) => [
        pairKey({ keyId: row.keyId, writer: row.writerAddress }),
        row,
      ])
    )
    const reads = new Map(args.chain.paid.map((p) => [pairKey(p), p]))
    const plan: Array<{
      voucher: Doc<'tabVouchers'>
      chainPaid: bigint
      marked: bigint
    }> = []
    for (const p of args.pairs) {
      const voucher = byPair.get(pairKey(p))
      const read = reads.get(pairKey(p))
      if (!voucher || !read) {
        return refuse('MISSING_READ', `No row or chain read for ${pairKey(p)}.`)
      }
      const stored = big(voucher.paidOnChain)
      const chainPaid = big(read.paid)
      if (stored > chainPaid) {
        return refuse(
          'MISMATCH_PAID',
          `${pairKey(p)}: stored paid ${stored} is above the contract's ${chainPaid}.`
        )
      }
      // The ranges cover part of [0, stored]; everything else up to the
      // contract's paid is marked as indexed.
      const indexed = stored - pairUnindexed(voucher)
      plan.push({ voucher, chainPaid, marked: chainPaid - indexed })
    }

    const marked = plan.reduce((sum, p) => sum + p.marked, ZERO)
    const chainBalance = big(args.chain.balance)
    // Debits of missing events that the stored balance does not include.
    const excess = big(account.confirmedBalance) - chainBalance
    if (excess < ZERO || excess > marked) {
      return refuse(
        'BALANCE_MISMATCH',
        `Stored balance ${account.confirmedBalance}, contract ${chainBalance}: ` +
          `the difference is not explained by the ${marked} of unindexed payments.`
      )
    }

    // Predicted figures: the contract's balance, the pairs' outstanding at
    // the contract's paid, and no reserve left for the reconciled pairs.
    let outstanding = big(account.outstanding)
    let unindexed = big(account.settledUnindexed ?? '0')
    for (const p of plan) {
      if (p.voucher.state === 'ACTIVE') {
        outstanding -=
          pairOutstanding(p.voucher) -
          pairOutstanding({
            cumulative: p.voucher.cumulative,
            paidOnChain: p.chainPaid.toString(),
          })
      }
      unindexed -= pairUnindexed(p.voucher)
    }
    const after = {
      confirmedBalance: chainBalance.toString(),
      outstanding: outstanding.toString(),
      settledUnindexed: unindexed.toString(),
    }
    const pairs = plan.map((p) => ({
      keyId: p.voucher.keyId,
      writer: p.voucher.writerAddress,
      paidBefore: p.voucher.paidOnChain,
      paidAfter: p.chainPaid.toString(),
      marked: p.marked.toString(),
    }))
    const before = figuresOf(account)
    if (marked === ZERO) {
      return {
        status: 'nothing_to_do',
        ledger: L,
        before,
        after: before,
        pairs,
      }
    }
    // Never above the chain: the contract's balance less what is still owed.
    const owed = vouchers.reduce((sum, row) => {
      if (row.state !== 'ACTIVE') return sum
      const scoped = plan.find((p) => p.voucher._id === row._id)
      return (
        sum +
        pairOutstanding({
          cumulative: row.cumulative,
          paidOnChain: scoped ? scoped.chainPaid.toString() : row.paidOnChain,
        })
      )
    }, ZERO)
    if (readerSpendable(after) > chainBalance - owed) {
      throw new Error('tabReconcile: the plan would exceed the chain balance')
    }
    if (!args.apply) {
      return {
        status: 'dry_run',
        ledger: L,
        before,
        after: figuresOf(after),
        pairs,
      }
    }

    for (const p of plan) {
      if (p.chainPaid > big(p.voucher.paidOnChain)) {
        await applyPairSettlement(ctx, {
          voucherId: p.voucher._id,
          paidAfter: p.chainPaid,
          // The contract's paid, not a shortfall: the rest is still owed.
          cumulative: p.chainPaid,
          sourceLedger: L,
          now,
        })
      }
      await releasePairReserve(ctx, p.voucher._id, now)
    }
    const current = (await ctx.db.get(account._id))!
    await ctx.db.patch(account._id, {
      confirmedBalance: chainBalance.toString(),
      balanceEventId: synthetic,
      balanceLedger: L,
      settledSinceBalance: current.settledSinceBalance.filter(
        (s) => s.eventId > synthetic
      ),
      updatedAt: now,
    })
    const done = (await ctx.db.get(account._id))!
    await recordReserveRelease(ctx, {
      account,
      after: done,
      source: 'reconcile',
      ledger: L,
      eventId: synthetic,
      pairs: plan.map((p, i) => ({
        voucherId: p.voucher._id,
        keyId: p.voucher.keyId,
        writerAddress: p.voucher.writerAddress,
        paidBefore: pairs[i]!.paidBefore,
        paidAfter: pairs[i]!.paidAfter,
        released: pairs[i]!.marked,
      })),
      ...(args.note ? { note: args.note } : {}),
      now,
    })
    return {
      status: 'applied',
      ledger: L,
      before,
      after: figuresOf(done),
      pairs,
    }
  },
})

/**
 * Operator entry point (internal):
 *
 *   bunx convex run chain/tabReconcile:run '{"reader":"G…"}'
 *   bunx convex run chain/tabReconcile:run '{"reader":"G…","apply":true,"note":"…"}'
 *
 * `keyId` and `writer` limit it to one pair. Without `apply` it is a dry run.
 */
export const run = internalAction({
  args: {
    reader: v.string(),
    keyId: v.optional(v.number()),
    writer: v.optional(v.string()),
    apply: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReconcileResult> => {
    const chain = readChainEnv()
    const snap = await ctx.runQuery(internal.chain.tabReconcile.snapshot, {
      reader: args.reader,
      ...(args.keyId !== undefined ? { keyId: args.keyId } : {}),
      ...(args.writer !== undefined ? { writer: args.writer } : {}),
    })
    if (!snap) return refuse('NOT_FOUND', 'No tab account for this reader.')
    const read = await readTabChainState(
      createBackendRpcClient(),
      chain,
      snap.tabContractId,
      snap.readerAddress,
      snap.pairs
    )
    return ctx.runMutation(internal.chain.tabReconcile.reconcile, {
      tabAccountId: snap.tabAccountId,
      digest: snap.digest,
      pairs: snap.pairs,
      chain: read,
      apply: args.apply === true,
      ...(args.note ? { note: args.note } : {}),
    })
  },
})

async function staleReserves(
  ctx: QueryCtx,
  olderThanMs: number,
  limit: number
) {
  const cutoff = Date.now() - olderThanMs
  const accounts = await ctx.db
    .query('tabAccounts')
    .withIndex('by_unindexed_since', (q) =>
      q.gt('settledUnindexedSince', 0).lt('settledUnindexedSince', cutoff)
    )
    .take(limit)
  const rows = []
  for (const account of accounts) {
    const pairs = (await accountVouchers(ctx, account._id))
      .filter((row) => pairUnindexed(row) > ZERO)
      .map((row) => ({
        keyId: row.keyId,
        writerAddress: row.writerAddress,
        paidOnChain: row.paidOnChain,
        unindexed: pairUnindexed(row).toString(),
        paidLedger: row.paidLedger ?? null,
      }))
    rows.push({
      tabAccountId: account._id as string,
      readerAddress: account.readerAddress,
      status: account.status,
      settledUnindexed: account.settledUnindexed ?? '0',
      since: account.settledUnindexedSince ?? null,
      balanceLedger: account.balanceLedger ?? null,
      pairs,
    })
  }
  return rows
}

/**
 * Accounts whose settlement reserve has stayed above 0 for longer than
 * `olderThanMs` (default an hour): a `TabSettled` that the indexer has not
 * applied. For scripts and the runbook check.
 */
export const listStaleReserves = internalQuery({
  args: {
    olderThanMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    staleReserves(ctx, args.olderThanMs ?? STALE_RESERVE_MS, args.limit ?? 50),
})

/** The same list for `app/ops/chain`. Null unless the user is in `OPS_USER_IDS`. */
export const getStaleReserves = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId || !opsUserIds().has(userId)) return null
    readChainEnv()
    return {
      olderThanMs: STALE_RESERVE_MS,
      rows: await staleReserves(ctx, STALE_RESERVE_MS, 50),
    }
  },
})
