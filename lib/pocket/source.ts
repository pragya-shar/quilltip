'use client'

import { createContext, useContext } from 'react'
import { liveSource } from './liveSource'
import type { ActivityView, BalanceView, EarningsView } from './types'

/**
 * Where the balance reads money from: the money layer by default
 * (`liveSource`), or a fixture through `PocketSourceContext`. Only the
 * balance's own components import this file, and they load with the sheet
 * or panel when it opens and with /pocket: the money layer is never in a
 * public first load.
 */

/**
 * A money act started from a sheet: Add money, Withdraw. The sheet renders
 * its phases and moves focus to its status and result; the money layer owns
 * what happens. Null while the act does not exist in the backend: the sheet
 * then says what will be possible and offers no action.
 */
export type MoneyActPhase =
  | { phase: 'idle' }
  /** Started; nothing is final. `status`: "Adding $10". */
  | { phase: 'working'; status: string }
  /** The server confirmed it. `result`: "$10 added to your balance". */
  | { phase: 'done'; result: string }
  /** It did not happen. `reason` says what was and was not moved. */
  | { phase: 'failed'; reason: string }

export type MoneyAct = {
  /** The button, stating what it does: "Add $10". */
  label: string
  state: MoneyActPhase
  start(): void
  reset(): void
}

export type PocketSource = {
  /** False where no money layer can answer (no backend client): the
   * balance then says so and points to the pages that work. */
  useWired(): boolean
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
  /** Adding testnet money from a wallet; null until the money layer can. */
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
  limits: null,
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
  useWired: () => false,
  format: { money: () => '', token: () => '' },
  useBalance: () => unavailableBalance,
  useEarnings: () => unavailableEarnings,
  useActivity: () => unavailableActivity,
  useAddMoney: () => null,
  useWithdraw: () => null,
}

export const PocketSourceContext = createContext<PocketSource>(liveSource)

export function usePocketSource(): PocketSource {
  return useContext(PocketSourceContext)
}
