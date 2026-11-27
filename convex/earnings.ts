/**
 * The signed-in writer's earnings (payments v3, slice 1). Three disjoint
 * figures whose sum is the lifetime total of tips that did not fail:
 *
 * - `pending`: balance tips accepted by the server, not yet paid on chain.
 * - `available`: paid on chain and collectable now (claimable in the Tab):
 *   settled minus collected.
 * - `collected`: already in the writer's wallet: collected balance tips,
 *   plus tips paid straight to the wallet (`totalEarnedCents` beyond the
 *   settled balance tips), so the scope is the one `authorEarnings` keeps.
 *
 * A tip whose payout failed is in none of the three: it is on hold (the
 * reader's balance ran short; it is paid if the reader adds funds) or not
 * paid, each with its own figure and the reason in `activity.mine`.
 *
 * Every figure is a running total kept by the ledger in the mutation that
 * changes a receipt or indexes a collect (`lib/chain/balanceFigures.ts`),
 * never a scan, so it is exact at any history length. Invariants:
 * `lib/moneyViews.ts`.
 */
import { query } from './_generated/server'
import { roundCents } from './lib/authorEarnings'
import { caller, settlementExpectation } from './lib/moneyViews'

const ZERO = BigInt(0)
const big = (value: string | undefined) => (value ? BigInt(value) : ZERO)

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await caller(ctx)
    if (!me) return null
    const row = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', me.userId))
      .first()
    const token = me.chain.tokenContractId ?? ''
    const settled = row?.balanceSettledCents ?? 0
    const balanceCollected = row?.balanceCollectedCents ?? 0
    const pendingCents = row?.balancePendingCents ?? 0
    const availableCents = Math.max(0, roundCents(settled - balanceCollected))
    // Tips paid straight to the wallet: earned, but never a balance tip.
    const directCents = Math.max(
      0,
      roundCents((row?.totalEarnedCents ?? 0) - settled)
    )
    const collectedCents = roundCents(balanceCollected + directCents)
    const earned = big(row?.earnedBaseUnits?.[token])
    const collectedBase = big(row?.collectedBaseUnits?.[token])
    const claimable = earned - collectedBase
    return {
      writerAddress: me.address,
      pendingCents,
      availableCents,
      collectedCents,
      totalCents: roundCents(pendingCents + availableCents + collectedCents),
      onHoldCents: row?.balanceOnHoldCents ?? 0,
      notPaidCents: row?.balanceNotPaidCents ?? 0,
      pendingCount: row?.balancePendingCount ?? 0,
      settledCount: row?.balanceSettledCount ?? 0,
      onHoldCount: row?.balanceOnHoldCount ?? 0,
      notPaidCount: row?.balanceNotPaidCount ?? 0,
      /** Settled tips, balance and direct (`authorEarnings.tipCount`). */
      tipCount: row?.tipCount ?? 0,
      baseUnits: {
        token: 'XLM' as const,
        /** Pairs' pending net; includes tips on hold for shortfall. */
        pending: row?.pendingBaseUnits?.[token] ?? '0',
        /** Collectable now: settled on chain minus collected. */
        available: (claimable > ZERO ? claimable : ZERO).toString(),
        collected: collectedBase.toString(),
      },
      /** The running figures behind the three, for reconciliation. */
      figures: {
        balanceSettledCents: settled,
        balanceCollectedCents: balanceCollected,
        directCents,
        totalEarnedCents: row?.totalEarnedCents ?? 0,
      },
      settlement: settlementExpectation(),
    }
  },
})
