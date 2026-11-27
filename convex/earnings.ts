/**
 * The signed-in writer's earnings (payments v3, slice 1). Three disjoint
 * figures whose sum is the lifetime total of tips that did not fail:
 *
 * - `pending`: tab tips accepted by the server, not yet paid on chain
 *   (`tabPendingCents`).
 * - `available`: balance tips paid on chain and collectable now. Token
 *   amount: settled tab base units minus collected ones
 *   (`readyToCollectBaseUnits`). Cents: settled tab cents minus collected
 *   ones (`tabEarnedCents - tabCollectedCents`). The same tips in both units.
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
import type { Doc } from './_generated/dataModel'
import { query } from './_generated/server'
import { roundCents } from './lib/authorEarnings'
import { tabSettledOf } from './lib/lifetimeEarnings'
import { caller, settlementExpectation } from './lib/moneyViews'

const ZERO = BigInt(0)
const big = (value: string | undefined) => (value ? BigInt(value) : ZERO)

/**
 * Ready to collect, in base units, from balance-tip figures only: the tab
 * tips' net paid on chain (the lifetime totals' settled base units, #552)
 * minus what indexed `Claimed` events collected (`collectedBaseUnits`).
 * Wallet tips are never part of it (they were paid straight to the wallet),
 * so it does not read `earnedBaseUnits`. Never below zero for display; a
 * negative value is flagged.
 */
export function readyToCollectBaseUnits(
  row: Doc<'authorEarnings'> | null | undefined,
  token: string
): bigint {
  const left =
    tabSettledOf(row, token).baseUnits - big(row?.collectedBaseUnits?.[token])
  if (left < ZERO) {
    console.warn(
      JSON.stringify({
        code: 'EARNINGS_READY_NEGATIVE',
        userId: row?.userId ?? null,
        token,
        value: left.toString(),
      })
    )
    return ZERO
  }
  return left
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
    // A writer has published an article or received a tip; anyone else
    // has no earnings to show (`isWriter` false), not earnings of zero.
    const isWriter =
      !!row ||
      !!(await ctx.db
        .query('articles')
        .withIndex('by_author_published', (q) =>
          q.eq('authorId', me.userId).eq('published', true)
        )
        .first())
    const token = me.chain.tokenContractId ?? ''
    const tab = tabSettledOf(row, token)
    // The oldest tip still on its way, for the lag notice (no row scan).
    const oldestPending = await ctx.db
      .query('tabReceipts')
      .withIndex('by_author_status_accepted', (q) =>
        q.eq('authorId', me.userId).eq('status', 'ACCEPTED')
      )
      .order('asc')
      .first()
    const settled = tab.cents
    const tabCollected = row?.tabCollectedCents ?? 0
    const pendingCents = row?.tabPendingCents ?? 0
    const availableCents = Math.max(0, roundCents(settled - tabCollected))
    const walletCents = row?.v2EarnedCents ?? 0
    const collectedCents = roundCents(tabCollected + walletCents)
    return {
      isWriter,
      writerAddress: me.address,
      pendingCents,
      availableCents,
      collectedCents,
      totalCents: roundCents(pendingCents + availableCents + collectedCents),
      onHoldCents: row?.tabOnHoldCents ?? 0,
      notPaidCents: row?.tabNotPaidCents ?? 0,
      pendingCount: row?.tabPendingCount ?? 0,
      /** When the oldest tip still on its way was accepted; null if none. */
      oldestPendingAt: oldestPending?.acceptedAt ?? null,
      settledCount: tab.tipCount,
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
        settledCents: settled,
        tabCollectedCents: tabCollected,
        walletCents,
        settledBaseUnits: tab.baseUnits.toString(),
      },
      settlement: settlementExpectation(),
    }
  },
})
