/**
 * The signed-in writer's earnings (payments v3, slice 1). Three disjoint
 * figures whose sum is the lifetime total of tips that did not fail:
 *
 * - `pending`: tab tips accepted by the server, not yet paid on chain
 *   (`tabPendingCents`).
 * - `available`: paid on chain and collectable now. Token amount: the
 *   lifetime totals' "ready to collect", `earnedBaseUnits -
 *   walletEarnedBaseUnits - collectedBaseUnits` (#552). Cents: settled tab
 *   cents minus collected ones (`tabEarnedCents - tabCollectedCents`).
 * - `collected`: already in the writer's wallet: collected tab tips plus
 *   tips paid straight to the wallet (`v2EarnedCents`).
 *
 * A tip whose payout failed is in none of the three: it is on hold (the
 * reader's balance ran short; it is paid if the reader adds funds) or not
 * paid, each with its own figure and the reason in `activity.mine`.
 *
 * Every figure is a running total kept by the ledger in the mutation that
 * changes a receipt or indexes a collect (`lib/chain/balanceFigures.ts`),
 * never a scan, so it is exact at any history length. Cents carry
 * 1/10,000 of a cent; the screens floor them to whole cents.
 */
import { query } from './_generated/server'
import { roundCents } from './lib/authorEarnings'
import { caller, settlementExpectation } from './lib/moneyViews'

const ZERO = BigInt(0)
const big = (value: string | undefined) => (value ? BigInt(value) : ZERO)

/** "Ready to collect" in base units, as the lifetime totals define it. */
export function readyToCollectBaseUnits(
  row:
    | {
        earnedBaseUnits?: Record<string, string>
        walletEarnedBaseUnits?: Record<string, string>
        collectedBaseUnits?: Record<string, string>
      }
    | null
    | undefined,
  token: string
): bigint {
  const left =
    big(row?.earnedBaseUnits?.[token]) -
    big(row?.walletEarnedBaseUnits?.[token]) -
    big(row?.collectedBaseUnits?.[token])
  return left > ZERO ? left : ZERO
}

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
    const settled = row?.tabEarnedCents ?? 0
    const tabCollected = row?.tabCollectedCents ?? 0
    const pendingCents = row?.tabPendingCents ?? 0
    const availableCents = Math.max(0, roundCents(settled - tabCollected))
    const walletCents = row?.v2EarnedCents ?? 0
    const collectedCents = roundCents(tabCollected + walletCents)
    return {
      writerAddress: me.address,
      pendingCents,
      availableCents,
      collectedCents,
      totalCents: roundCents(pendingCents + availableCents + collectedCents),
      onHoldCents: row?.tabOnHoldCents ?? 0,
      notPaidCents: row?.tabNotPaidCents ?? 0,
      pendingCount: row?.tabPendingCount ?? 0,
      settledCount: row?.tabTipCount ?? 0,
      onHoldCount: row?.tabOnHoldCount ?? 0,
      notPaidCount: row?.tabNotPaidCount ?? 0,
      baseUnits: {
        token: 'XLM' as const,
        /** Pairs' pending net; includes tips on hold for shortfall. */
        pendingAndOnHold: row?.pendingBaseUnits?.[token] ?? '0',
        /** Ready to collect now. */
        available: readyToCollectBaseUnits(row, token).toString(),
        collected: big(row?.collectedBaseUnits?.[token]).toString(),
      },
      /** The running figures behind the three, for reconciliation. */
      figures: {
        tabEarnedCents: settled,
        tabCollectedCents: tabCollected,
        walletCents,
        tabSettledBaseUnits: row?.tabSettledBaseUnits?.[token] ?? '0',
      },
      settlement: settlementExpectation(),
    }
  },
})
