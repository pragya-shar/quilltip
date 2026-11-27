'use client'

import { createContext, useContext } from 'react'
import type { ActivityView, BalanceView, EarningsView } from './types'

/**
 * A money act started from a sheet: Add money, Withdraw. The sheet renders
 * its phases and moves focus to its status and result; the money layer owns
 * what happens. Null while the act does not exist in the backend: the sheet
 * then says what will be possible and offers no action.
 */
export type MoneyActPhase =
  | { phase: 'idle' }
  /** Started; nothing is final. `status`: "Adding $5". */
  | { phase: 'working'; status: string }
  /** The server confirmed it. `result`: "$5 added to your balance". */
  | { phase: 'done'; result: string }
  /** It did not happen. `reason` says what was and was not moved. */
  | { phase: 'failed'; reason: string }

export type MoneyAct = {
  /** The button, stating what it does: "Add $5 practice money". */
  label: string
  state: MoneyActPhase
  start(): void
  reset(): void
}

/**
 * Where the Pocket reads money from: one seam, so the live money layer and a
 * fixture are interchangeable. The live source reads `hooks/payments` once
 * pull request 561 is merged; until then every view is unavailable.
 */
export type PocketSource = {
  /** The money layer's own formatters, for the receipt and the exact
   * amount: `formatExactCents` ("9.75¢", never floored) and
   * `formatTokenAmount` ("2.8571428 XLM") from `lib/payments/money`. */
  format: {
    exactCents(cents: number): string
    token(baseUnits: string): string
  }
  useBalance(): BalanceView
  useEarnings(): EarningsView
  useActivity(role: 'reader' | 'writer'): ActivityView
  /** The practice-money flow of slice 2, then real funding. */
  useAddMoney(): MoneyAct | null
  /** The writer's collect (B4). */
  useWithdraw(): MoneyAct | null
}

const noop = () => {}

const unavailableBalance: BalanceView = {
  status: 'unavailable',
  available: null,
  pending: null,
  device: 'unavailable',
  settlement: { enabled: false, expectedWithinMs: 0 },
  online: true,
  network: 'testnet',
}

const unavailableEarnings: EarningsView = {
  status: 'unavailable',
  pending: null,
  available: null,
  collected: null,
  total: null,
  onHold: null,
  notPaid: null,
  counts: null,
  lagging: false,
  exact: null,
}

const unavailableActivity: ActivityView = {
  status: 'unavailable',
  items: [],
  canLoadMore: false,
  loadMore: noop,
}

/** Until the money layer is wired: payments cannot answer. */
export const unwiredSource: PocketSource = {
  // Nothing is shown before the money layer is wired, so nothing is
  // formatted either.
  format: { exactCents: () => '', token: () => '' },
  useBalance: () => unavailableBalance,
  useEarnings: () => unavailableEarnings,
  useActivity: () => unavailableActivity,
  useAddMoney: () => null,
  useWithdraw: () => null,
}

export const PocketSourceContext = createContext<PocketSource>(unwiredSource)

export function usePocketSource(): PocketSource {
  return useContext(PocketSourceContext)
}
