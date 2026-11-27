'use client'

import { createContext, useContext } from 'react'
import type { ActivityView, BalanceView, EarningsView } from './types'

/**
 * Where the balance reads money from: one seam, so the live money layer and
 * a fixture are interchangeable. This file holds no component code, so the
 * shell can mount a live provider without loading the balance's screens in
 * a page's first load.
 */

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

export type PocketSource = {
  /** False until the live money layer is connected in this build: the
   * balance then says so and points to the pages that work. */
  wired: boolean
  /** The money layer's own formatters: `money` writes exact dollars (to six
   * decimals when there are fractions of a cent, as `formatMoney` does);
   * `token` writes a base-unit amount ("2.8571428 XLM"). */
  format: {
    money(cents: number): string
    token(baseUnits: string): string
  }
  useBalance(): BalanceView
  useEarnings(): EarningsView
  useActivity(role: 'reader' | 'writer'): ActivityView
  /** Practice money for new accounts, then funding from a wallet. */
  useAddMoney(): MoneyAct | null
  /** Collecting a writer's earnings to their wallet. */
  useWithdraw(): MoneyAct | null
}

const noop = () => {}

const unavailableBalance: BalanceView = {
  status: 'unavailable',
  available: null,
  pending: null,
  deviceReady: false,
  device: 'unavailable',
  amounts: [],
  noAmountReason: null,
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

/** Until the money layer is connected: nothing to read. */
export const unwiredSource: PocketSource = {
  wired: false,
  format: { money: () => '', token: () => '' },
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
