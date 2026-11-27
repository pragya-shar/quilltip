/**
 * Database side of the tab settler (docs/architecture/v2/03-tab-contract.md,
 * section 3.8). `convex/tabSettlement.ts` exposes these as internal functions;
 * `runSettlementCycle` in `settler.ts` drives them.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import type { ChainEnv } from './env'
import type {
  OpenSettlement,
  PreparedSubmission,
  SelectionResult,
  SettleCandidate,
  SettlementFinish,
} from './settler'
import { EXPIRING_LEDGERS, SETTLEMENT_CONFIRMED } from './settler'
import { SKIP_REASONS } from './tabEventHandlers'
import {
  applyPairPayment,
  applyPairSettlement,
  closeUnpaidPair,
  pairOutstanding,
  refreshSettleQueue,
  rejectPair,
  settlementVoucher,
  tabAccountForReader,
  tabKey,
  tabVoucher,
} from './tabLedger'

/** Rows read from each selection source per run. */
export const SELECTION_SCAN = 300

type Chain = Pick<ChainEnv, 'network' | 'chainEpoch'> & {
  tabContractId: string
}

function candidateOf(
  v: Doc<'tabVouchers'>,
  account: Doc<'tabAccounts'> | null,
  publicKey: string | undefined
): SettleCandidate {
  return {
    voucherId: v._id,
    chainEpoch: v.chainEpoch,
    voucher: settlementVoucher(v, publicKey),
    paidOnChain: v.paidOnChain,
    unsettledAmount: pairOutstanding(v).toString(),
    oldestUnsettledAt: v.oldestUnsettledAt ?? null,
    accountStatus: account?.status ?? null,
    settleBy: v.settleBy ?? 0,
  }
}

/**
 * Selectable pairs from three bounded sources: pairs of closing tabs, the
 * soonest window ends (`by_queue_settle_by`) and the oldest unsettled
 * receipts (`by_queue_age`). Only `ready` pairs of the current epoch and Tab
 * are returned; expired, parked, in-flight and terminal pairs are in other
 * queues, so they cannot crowd the sources out.
 */
export async function selectSettlementCandidates(
  ctx: QueryCtx,
  chain: Chain,
  at: { ledger: number; now: number }
): Promise<SelectionResult> {
  const rows = new Map<string, Doc<'tabVouchers'>>()
  const closing = await ctx.db
    .query('tabAccounts')
    .withIndex('by_status', (q) => q.eq('status', 'CLOSING'))
    .take(100)
  for (const account of closing) {
    const pairs = await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) => q.eq('tabAccountId', account._id))
      .take(100)
    for (const v of pairs) rows.set(v._id, v)
  }
  for (const v of await ctx.db
    .query('tabVouchers')
    .withIndex('by_queue_settle_by', (q) =>
      q.eq('settleQueue', 'ready').gte('settleBy', at.ledger)
    )
    .take(SELECTION_SCAN)) {
    rows.set(v._id, v)
  }
  for (const v of await ctx.db
    .query('tabVouchers')
    .withIndex('by_queue_age', (q) => q.eq('settleQueue', 'ready'))
    .take(SELECTION_SCAN)) {
    rows.set(v._id, v)
  }

  const candidates: SettleCandidate[] = []
  let oldestUnsettledAt: number | null = null
  let expiringCount = 0
  let expiringAmount = BigInt(0)
  for (const v of rows.values()) {
    if (
      v.settleQueue !== 'ready' ||
      v.state !== 'ACTIVE' ||
      v.chainEpoch !== chain.chainEpoch ||
      v.tabContractId !== chain.tabContractId ||
      v.settleBy === undefined ||
      v.settleBy < at.ledger
    ) {
      continue
    }
    const owed = pairOutstanding(v)
    if (owed === BigInt(0)) continue
    const account = await ctx.db.get(v.tabAccountId)
    const key = await tabKey(ctx, v.tabAccountId, v.keyId)
    candidates.push(candidateOf(v, account, key?.publicKey))
    if (
      v.oldestUnsettledAt !== undefined &&
      (oldestUnsettledAt === null || v.oldestUnsettledAt < oldestUnsettledAt)
    ) {
      oldestUnsettledAt = v.oldestUnsettledAt
    }
    if (v.settleBy - at.ledger <= EXPIRING_LEDGERS) {
      expiringCount++
      expiringAmount += owed
    }
  }
  return {
    candidates,
    oldestUnsettledAt,
    expiring: { count: expiringCount, amount: expiringAmount.toString() },
  }
}

export async function openSettlements(
  ctx: QueryCtx
): Promise<OpenSettlement[]> {
  const out: OpenSettlement[] = []
  for (const status of ['PREPARED', 'SUBMITTED'] as const) {
    const rows = await ctx.db
      .query('tabSettlements')
      .withIndex('by_status', (q) => q.eq('status', status))
      .take(10)
    for (const row of rows) {
      out.push({
        settlementId: row._id,
        status,
        reference: row.reference ?? null,
        txHash: row.txHash ?? null,
        envelopeXdr: row.envelopeXdr ?? null,
        maxTime: row.maxTime ?? 0,
        attempts: row.attempts ?? 0,
      })
    }
  }
  return out
}

/**
 * Creates the settlement record and takes its pairs out of the ready queue.
 * Refuses a pair that changed state or joined another settlement since
 * selection, so two runs can never submit one pair.
 */
export async function beginSettlement(
  ctx: MutationCtx,
  chain: Chain,
  args: {
    voucherIds: Id<'tabVouchers'>[]
    cumulatives: string[]
    submitter: string
    maxTime: number
    now: number
  }
): Promise<Id<'tabSettlements'>> {
  if (args.voucherIds.length !== args.cumulatives.length) {
    throw new Error('One cumulative amount per voucher is required')
  }
  const open = await openSettlements(ctx)
  if (open.length) throw new Error('A settlement is already open')
  for (const id of args.voucherIds) {
    const v = await ctx.db.get(id)
    if (
      !v ||
      v.state !== 'ACTIVE' ||
      v.settleQueue !== 'ready' ||
      v.settlementId
    ) {
      throw new Error(`Voucher ${id} is no longer ready`)
    }
  }
  const settlementId = await ctx.db.insert('tabSettlements', {
    network: chain.network,
    chainEpoch: chain.chainEpoch,
    tabContractId: chain.tabContractId,
    submitter: args.submitter,
    maxTime: args.maxTime,
    voucherIds: args.voucherIds,
    cumulatives: args.cumulatives,
    gross: '0',
    fee: '0',
    status: 'PREPARED',
    attempts: 0,
    createdAt: args.now,
    updatedAt: args.now,
  })
  for (const id of args.voucherIds) {
    await ctx.db.patch(id, {
      settlementId,
      settleQueue: 'inflight',
      updatedAt: args.now,
    })
  }
  return settlementId
}

export async function recordSettlementPrepared(
  ctx: MutationCtx,
  settlementId: Id<'tabSettlements'>,
  prepared: PreparedSubmission,
  now: number
): Promise<void> {
  const row = await ctx.db.get(settlementId)
  if (!row || row.status !== 'PREPARED') {
    throw new Error('Settlement is not awaiting submission')
  }
  await ctx.db.patch(settlementId, {
    status: 'SUBMITTED',
    reference: prepared.reference,
    ...(prepared.txHash ? { txHash: prepared.txHash } : {}),
    ...(prepared.envelopeXdr ? { envelopeXdr: prepared.envelopeXdr } : {}),
    updatedAt: now,
  })
}

export async function noteSettlementAttempt(
  ctx: MutationCtx,
  settlementId: Id<'tabSettlements'>,
  error: string,
  now: number
): Promise<void> {
  const row = await ctx.db.get(settlementId)
  if (!row) return
  await ctx.db.patch(settlementId, {
    attempts: (row.attempts ?? 0) + 1,
    lastError: error.slice(0, 500),
    updatedAt: now,
  })
}

async function release(
  ctx: MutationCtx,
  settlement: Doc<'tabSettlements'>,
  now: number
): Promise<void> {
  for (const id of settlement.voucherIds) {
    const v = await ctx.db.get(id)
    if (!v || v.settlementId !== settlement._id) continue
    await ctx.db.patch(id, { settlementId: undefined, updatedAt: now })
    await refreshSettleQueue(ctx, id, now)
  }
}

/**
 * Applies a settlement's result and releases its pairs. A `CONFIRMED` result
 * applies each `TabSettled` and `VoucherSkipped` outcome to its pair; the
 * indexer applies the same events again idempotently and debits the balance.
 */
export async function finishSettlement(
  ctx: MutationCtx,
  settlementId: Id<'tabSettlements'>,
  result: SettlementFinish,
  now: number
): Promise<void> {
  const settlement = await ctx.db.get(settlementId)
  if (!settlement) return
  if (settlement.status !== 'PREPARED' && settlement.status !== 'SUBMITTED') {
    return
  }
  if (result.status !== 'CONFIRMED') {
    await ctx.db.patch(settlementId, {
      status: result.status,
      lastError: result.reason,
      ...(result.txHash ? { txHash: result.txHash } : {}),
      updatedAt: now,
    })
    await release(ctx, settlement, now)
    return
  }

  let gross = BigInt(0)
  let fee = BigInt(0)
  let settled = 0
  let skipped = 0
  for (const o of result.outcomes) {
    const account = await tabAccountForReader(
      ctx,
      o.reader,
      settlement.chainEpoch
    )
    const voucher = account
      ? await tabVoucher(ctx, account._id, o.keyId, o.writer)
      : null
    if (o.kind === 'settled') {
      settled++
      gross += BigInt(o.gross)
      fee += BigInt(o.fee)
      if (voucher) {
        await applyPairSettlement(ctx, {
          voucherId: voucher._id,
          paidAfter: BigInt(o.paidAfter),
          cumulative: BigInt(o.cumulative),
          sourceLedger: result.ledger,
          now,
        })
      }
      continue
    }
    skipped++
    if (!voucher) continue
    const reason =
      SKIP_REASONS[o.reason as keyof typeof SKIP_REASONS] ??
      ('UNKNOWN' as const)
    await ctx.db.patch(voucher._id, { lastSkipReason: reason, updatedAt: now })
    if (reason === 'SHORTFALL') {
      await applyPairPayment(ctx, voucher._id, {
        shortfallUpTo: BigInt(o.cumulative),
        now,
      })
      await ctx.db.patch(voucher._id, { settlementId: undefined })
      await refreshSettleQueue(ctx, voucher._id, now, { block: true })
    } else if (reason === 'KEY_EXPIRED' || reason === 'KEY_UNKNOWN') {
      await closeUnpaidPair(ctx, voucher._id, now)
    } else if (reason === 'STALE') {
      // The contract holds `Paid >= cumulative` (for example after the
      // writer's `settle_own`); the indexed `TabSettled` adds the rest.
      await applyPairSettlement(ctx, {
        voucherId: voucher._id,
        paidAfter: BigInt(o.cumulative),
        cumulative: BigInt(o.cumulative),
        // The writer's payment happened at or before this transaction.
        sourceLedger: result.ledger,
        now,
      })
    }
  }
  await ctx.db.patch(settlementId, {
    status: SETTLEMENT_CONFIRMED,
    txHash: result.txHash,
    ledger: result.ledger,
    gross: gross.toString(),
    fee: fee.toString(),
    settled,
    skipped,
    updatedAt: now,
  })
  await release(ctx, settlement, now)
}

export async function rejectVouchers(
  ctx: MutationCtx,
  items: Array<{ voucherId: Id<'tabVouchers'>; reason: string }>,
  now: number
): Promise<number> {
  let rejected = 0
  for (const item of items) {
    if (await rejectPair(ctx, item.voucherId, item.reason, now)) rejected++
  }
  return rejected
}
