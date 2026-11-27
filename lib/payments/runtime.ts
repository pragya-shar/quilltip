'use client'

/**
 * The one React context the payments hooks read (`hooks/payments/*`). The
 * root layout provides the live runtime (`components/payments/
 * PaymentsProvider.tsx`); fixtures provide a fake one. Without a provider the
 * hooks read a signed-out runtime, so a screen rendered outside the app shell
 * shows the signed-out state instead of failing.
 */
import { createContext, useContext } from 'react'
import { money } from './money'
import type {
  ActivityView,
  BalanceView,
  EarningsView,
  PaymentsRuntime,
  TipController,
} from './types'

const ZERO = money(0)

const SIGNED_OUT_BALANCE: BalanceView = {
  status: 'signed-out',
  available: ZERO,
  pending: ZERO,
  deviceReady: false,
  device: 'unavailable',
  limits: null,
  amounts: [],
  settlement: { enabled: false, expectedWithinMs: 0 },
  online: true,
  network: 'testnet',
}

const EMPTY_ACTIVITY: ActivityView = {
  status: 'ready',
  items: [],
  canLoadMore: false,
  loadMore: () => {},
}

const SIGNED_OUT_EARNINGS: EarningsView = {
  status: 'signed-out',
  pending: ZERO,
  available: ZERO,
  collected: ZERO,
  total: ZERO,
  onHold: ZERO,
  notPaid: ZERO,
  counts: { pending: 0, onHold: 0, notPaid: 0, settled: 0 },
  lagging: false,
  exact: null,
}

const NO_TIP: TipController = {
  state: { phase: 'idle' },
  amount: money(100),
  amounts: [],
  setAmount: () => {},
  tip: async () => {},
  reset: () => {},
  ready: true,
  unavailable: 'signed-out',
}

export const signedOutRuntime: PaymentsRuntime = {
  useBalance: () => SIGNED_OUT_BALANCE,
  useTip: () => NO_TIP,
  useActivity: () => EMPTY_ACTIVITY,
  useEarnings: () => SIGNED_OUT_EARNINGS,
}

export const PaymentsRuntimeContext =
  createContext<PaymentsRuntime>(signedOutRuntime)

export function usePaymentsRuntime(): PaymentsRuntime {
  return useContext(PaymentsRuntimeContext)
}
