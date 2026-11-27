/**
 * The signed-in writer's earnings from balance tips (payments v3, slice 1).
 *
 * `pending` is accepted by the server and not yet paid on chain; `available`
 * is paid on chain (the writer collects it from the Tab contract). A tip
 * whose payout failed is never pending and never available: it shows as on
 * hold (the reader's balance ran short; paid if the reader adds funds) or not
 * paid, with the reason in the writer's activity (`activity.mine`).
 * Invariants M1 to M4: `lib/moneyViews.ts`.
 */
import { query } from './_generated/server'
import { receiptNet } from './lib/chain/tabLedger'
import {
  caller,
  milliToCents,
  moneyStateOf,
  netMilliCents,
  receiptCents,
  settlementExpectation,
} from './lib/moneyViews'

/** Receipts summed per call; a writer with more sees the newest ones. */
export const EARNINGS_RECEIPT_SCAN = 4000

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await caller(ctx)
    if (!me) return null
    const epoch = me.chain.chainEpoch
    const receipts = await ctx.db
      .query('tabReceipts')
      .withIndex('by_author_accepted', (q) => q.eq('authorId', me.userId))
      .order('desc')
      .filter((q) => q.eq(q.field('chainEpoch'), epoch))
      .take(EARNINGS_RECEIPT_SCAN)

    const ZERO = BigInt(0)
    const milli = {
      pending: ZERO,
      available: ZERO,
      onHold: ZERO,
      notPaid: ZERO,
    }
    const base = { pending: ZERO, available: ZERO, onHold: ZERO, notPaid: ZERO }
    let tipCount = 0
    let notPaidCount = 0
    let onHoldCount = 0
    let oldestPendingAt: number | null = null
    const supporters = new Set<string>()
    for (const receipt of receipts) {
      const cents = await receiptCents(ctx, receipt)
      const m = netMilliCents(receipt, cents)
      const b = receiptNet(receipt)
      const { state, reason } = moneyStateOf(receipt.status)
      if (state === 'accepted') {
        milli.pending += m
        base.pending += b
        if (oldestPendingAt === null || receipt.acceptedAt < oldestPendingAt)
          oldestPendingAt = receipt.acceptedAt
      } else if (state === 'on-chain') {
        milli.available += m
        base.available += b
      } else if (reason === 'shortfall') {
        milli.onHold += m
        base.onHold += b
        onHoldCount++
      } else {
        milli.notPaid += m
        base.notPaid += b
        notPaidCount++
      }
      if (state !== 'not-paid') {
        tipCount++
        supporters.add(receipt.tabAccountId)
      }
    }

    // What the indexer saw paid on chain per pair, for reconciliation.
    const pairs = me.address
      ? (
          await ctx.db
            .query('tabVouchers')
            .withIndex('by_writer', (q) => q.eq('writerAddress', me.address!))
            .take(1000)
        ).filter((row) => row.chainEpoch === epoch)
      : []
    const onChainEarned = pairs.reduce(
      (sum, row) => sum + BigInt(row.earnedNet),
      ZERO
    )
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', me.userId))
      .first()
    const token = me.chain.tokenContractId
    const collected =
      (token ? earnings?.collectedBaseUnits?.[token] : undefined) ?? '0'

    const pendingCents = milliToCents(milli.pending)
    const availableCents = milliToCents(milli.available)
    return {
      writerAddress: me.address,
      pendingCents,
      availableCents,
      totalCents: milliToCents(milli.pending + milli.available),
      onHoldCents: milliToCents(milli.onHold),
      notPaidCents: milliToCents(milli.notPaid),
      tipCount,
      onHoldCount,
      notPaidCount,
      supporterCount: supporters.size,
      oldestPendingAt,
      baseUnits: {
        token: 'XLM' as const,
        pending: base.pending.toString(),
        available: base.available.toString(),
        onHold: base.onHold.toString(),
        notPaid: base.notPaid.toString(),
        onChainEarned: onChainEarned.toString(),
        collected,
      },
      settlement: settlementExpectation(),
    }
  },
})
