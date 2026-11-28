/**
 * Internal ledger functions of the tab settler
 * (docs/architecture/v2/03-tab-contract.md, section 3.8). The action in
 * `convex/tabSettler.ts` calls them; nothing here touches the network.
 */
import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { acquireLease, releaseLease } from './lib/chain/lease'
import {
  beginSettlement,
  finishSettlement,
  noteSettlementAttempt,
  openSettlements,
  recordSettlementPrepared,
  rejectVouchers,
  selectSettlementCandidates,
} from './lib/chain/settlementStore'
import { sweepExpiredPairs, tabError } from './lib/chain/tabLedger'

/** Longer than a run (resolve, simulate, send and poll), shorter than the cron. */
export const SETTLER_LEASE_TTL_MS = 8 * 60 * 1000
export const SWEEP_LIMIT = 200

function tabChain() {
  const chain = readChainEnv()
  if (!chain.tabContractId) {
    tabError('CHAIN_CONFIG_MISSING', 'TAB_CONTRACT_ID is not set.')
  }
  return { ...chain, tabContractId: chain.tabContractId }
}

export const acquireSettlerLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    return acquireLease(ctx, {
      name: 'settler',
      holder: args.holder,
      ttlMs: SETTLER_LEASE_TTL_MS,
      now: Date.now(),
      network: chain.network,
      chainEpoch: chain.chainEpoch,
    })
  },
})

export const releaseSettlerLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) => {
    await releaseLease(ctx, { name: 'settler', holder: args.holder })
  },
})

/**
 * Records the end of a settler run that did not fail on the `settler` lease
 * row, which the run created or renewed (#647). Read by `/ops/chain`.
 */
export const recordSettlerRun = internalMutation({
  args: { at: v.number() },
  handler: async (ctx, args) => {
    const lease = await ctx.db
      .query('chainLeases')
      .withIndex('by_name', (q) => q.eq('name', 'settler'))
      .unique()
    if (!lease) return
    if (lease.lastOkAt !== undefined && lease.lastOkAt >= args.at) return
    await ctx.db.patch(lease._id, { lastOkAt: args.at })
  },
})

export const listOpenSettlements = internalQuery({
  args: {},
  handler: async (ctx) => openSettlements(ctx),
})

/** Pairs whose settle window ended become `UNPAID`, for any account status. */
export const sweepExpired = internalMutation({
  args: { ledger: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    sweepExpiredPairs(ctx, {
      ledger: await indexedLedgerAtMost(ctx, args.ledger),
      limit: Math.min(Math.max(1, args.limit ?? SWEEP_LIMIT), 500),
      now: Date.now(),
    }),
})

/**
 * The sweep closes a pair only once the indexer has applied every ledger up to
 * the end of its window, so a settlement that landed in the last ledgers of
 * the window (for example a writer's `settle_own`) is counted before the pair
 * becomes `UNPAID`. Without an indexer cursor for this epoch, nothing closes.
 */
async function indexedLedgerAtMost(
  ctx: QueryCtx,
  ledger: number
): Promise<number> {
  const chain = readChainEnv()
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (!cursor || cursor.chainEpoch !== chain.chainEpoch) return 0
  return Math.min(ledger, cursor.lastLedger)
}

export const selectCandidates = internalQuery({
  args: { ledger: v.number(), now: v.number() },
  handler: async (ctx, args) =>
    selectSettlementCandidates(ctx, tabChain(), args),
})

export const rejectSettlementVouchers = internalMutation({
  args: {
    items: v.array(
      v.object({ voucherId: v.id('tabVouchers'), reason: v.string() })
    ),
  },
  handler: async (ctx, args) => rejectVouchers(ctx, args.items, Date.now()),
})

export const begin = internalMutation({
  args: {
    voucherIds: v.array(v.id('tabVouchers')),
    cumulatives: v.array(v.string()),
    submitter: v.string(),
    maxTime: v.number(),
  },
  handler: async (ctx, args) =>
    beginSettlement(ctx, tabChain(), { ...args, now: Date.now() }),
})

export const recordPrepared = internalMutation({
  args: {
    settlementId: v.id('tabSettlements'),
    reference: v.string(),
    txHash: v.union(v.string(), v.null()),
    envelopeXdr: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) =>
    recordSettlementPrepared(
      ctx,
      args.settlementId,
      {
        reference: args.reference,
        txHash: args.txHash,
        envelopeXdr: args.envelopeXdr,
      },
      Date.now()
    ),
})

export const noteAttempt = internalMutation({
  args: { settlementId: v.id('tabSettlements'), error: v.string() },
  handler: async (ctx, args) =>
    noteSettlementAttempt(ctx, args.settlementId, args.error, Date.now()),
})

const outcomeValidator = v.union(
  v.object({
    kind: v.literal('settled'),
    reader: v.string(),
    writer: v.string(),
    keyId: v.number(),
    cumulative: v.string(),
    paidAfter: v.string(),
    gross: v.string(),
    fee: v.string(),
  }),
  v.object({
    kind: v.literal('skipped'),
    reader: v.string(),
    writer: v.string(),
    keyId: v.number(),
    cumulative: v.string(),
    reason: v.number(),
  })
)

export const finish = internalMutation({
  args: {
    settlementId: v.id('tabSettlements'),
    result: v.union(
      v.object({
        status: v.literal('CONFIRMED'),
        txHash: v.string(),
        ledger: v.number(),
        outcomes: v.array(outcomeValidator),
      }),
      v.object({
        status: v.union(v.literal('FAILED'), v.literal('EXPIRED')),
        reason: v.string(),
        txHash: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) =>
    finishSettlement(ctx, args.settlementId, args.result, Date.now()),
})
