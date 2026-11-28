'use client'

/**
 * The one React context the payments hooks read (`hooks/payments/*`). Its
 * default is the shell runtime: hooks that read `paymentsStore`, which the
 * engine fills once it has loaded. A fixture can provide its own runtime.
 * The shell's hooks call the same React hooks before and after the engine
 * arrives, so nothing remounts or resets when it does.
 *
 * This file loads with the screens that use the hooks, not in a first load:
 * the blank views (before the engine has written a view) and the controller
 * a tip control shows before the engine computed one are here, not in the
 * store.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
} from 'react'
import { tipAmount } from './money'
import { paymentsStore, type PaymentsState } from './store'
import type {
  ActivityView,
  BalanceView,
  EarningsView,
  Money,
  OwnTipsView,
  PaymentsRuntime,
  TipController,
  TipMeta,
  TipTarget,
} from './types'

const ONE: Money = tipAmount(100)

type Blank = 'loading' | 'signed-out' | 'unavailable'

/** Which blank view shows: signed out first, then a failed engine. */
function blankOf(s: PaymentsState): Blank {
  return s.auth === 'signed-out'
    ? 'signed-out'
    : s.engine === 'failed'
      ? 'unavailable'
      : 'loading'
}

const LOADING_BALANCE: BalanceView = {
  status: 'loading',
  available: null,
  pending: null,
  deviceReady: false,
  device: 'loading',
  limits: null,
  amounts: [],
  noAmountReason: null,
  settlement: { enabled: false, expectedWithinMs: 0 },
  online: true,
  network: 'testnet',
}
const BALANCE: Record<Blank, BalanceView> = {
  loading: LOADING_BALANCE,
  'signed-out': {
    ...LOADING_BALANCE,
    status: 'signed-out',
    device: 'unavailable',
  },
  unavailable: {
    ...LOADING_BALANCE,
    status: 'unavailable',
    device: 'unavailable',
  },
}

const LOADING_ACTIVITY: ActivityView = {
  status: 'loading',
  items: [],
  canLoadMore: false,
  loadMore: () => {},
}
const ACTIVITY: Record<Blank, ActivityView> = {
  loading: LOADING_ACTIVITY,
  'signed-out': LOADING_ACTIVITY,
  unavailable: { ...LOADING_ACTIVITY, status: 'unavailable' },
}

const LOADING_EARNINGS: EarningsView = {
  status: 'loading',
  isWriter: null,
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
const EARNINGS: Record<Blank, EarningsView> = {
  loading: LOADING_EARNINGS,
  'signed-out': { ...LOADING_EARNINGS, status: 'signed-out' },
  unavailable: { ...LOADING_EARNINGS, status: 'unavailable' },
}

const OWN_TIPS: Record<Blank, OwnTipsView> = {
  loading: { status: 'loading', tips: [], complete: true },
  'signed-out': { status: 'signed-out', tips: [], complete: true },
  unavailable: { status: 'unavailable', tips: [], complete: true },
}

/** The views the hooks read: the engine's, else the blank one (stable). */
export const viewsOf = (s: PaymentsState) => ({
  balance: s.balance ?? BALANCE[blankOf(s)],
  readerActivity: s.readerActivity ?? ACTIVITY[blankOf(s)],
  writerActivity: s.writerActivity ?? ACTIVITY[blankOf(s)],
  earnings: s.earnings ?? EARNINGS[blankOf(s)],
})

/**
 * The controller a control shows before the engine computed one. With no
 * shell on the page nothing will answer, so the control says so at once
 * (`absent`) and a host keeps its other tip path instead of waiting.
 */
export function shellController(id: string): TipController {
  const state = paymentsStore.get()
  const absent = state.shells === 0
  const signedOut = !absent && state.auth === 'signed-out'
  const failed = !absent && state.engine === 'failed'
  return {
    state: { phase: 'idle' },
    amount: ONE,
    blocked: null,
    amounts: [],
    setAmount: () => {},
    tip: async () => {
      const reg = paymentsStore.get().registrations[id]
      if (absent || signedOut || failed || !reg) return
      // Not lost: the engine sends it once, when ready, for what was pressed:
      // this target and amount, under this request id.
      paymentsStore.queueTap(id, {
        ...reg,
        cents: ONE.cents,
        requestId: crypto.randomUUID(),
      })
    },
    reset: () => {},
    ready: absent || signedOut || failed,
    warming: !absent && state.auth === 'signed-in' && !failed,
    queued: id in state.queuedTaps,
    signedOut: null,
    unavailable: absent
      ? 'absent'
      : signedOut
        ? 'signed-out'
        : failed
          ? 'not-loaded'
          : null,
  }
}

function useStore<T>(select: (s: PaymentsState) => T): T {
  return useSyncExternalStore(
    paymentsStore.subscribe,
    () => select(paymentsStore.get()),
    () => select(paymentsStore.get())
  )
}

/** Controllers made before the engine: one per id, stable between reads. */
const shellControllers = new Map<
  string,
  { key: string; value: TipController }
>()

function useShellTip(target: TipTarget, meta: TipMeta) {
  const id = useId()
  useEffect(
    () => paymentsStore.register(id, { target, meta }),
    [id, target, meta]
  )
  return useStore((s) => {
    const computed = s.tips[id]
    if (computed) return computed
    const key = `${s.shells > 0}:${s.auth}:${s.engine}:${id in s.queuedTaps}`
    const cached = shellControllers.get(id)
    if (cached && cached.key === key) return cached.value
    const value = shellController(id)
    shellControllers.set(id, { key, value })
    return value
  })
}

export const shellRuntime: PaymentsRuntime = {
  useBalance: () => useStore((s) => viewsOf(s).balance),
  useTip: useShellTip,
  useActivity: (role) => {
    useEffect(
      () => (role === 'writer' ? paymentsStore.watch('writer') : undefined),
      [role]
    )
    return useStore((s) =>
      role === 'reader' ? viewsOf(s).readerActivity : viewsOf(s).writerActivity
    )
  },
  useEarnings: () => {
    useEffect(() => paymentsStore.watch('earnings'), [])
    return useStore((s) => viewsOf(s).earnings)
  },
  // The engine reads it for each article with a tip control on the page.
  useOwnTips: (articleId) =>
    useStore((s) => s.ownTips[articleId] ?? OWN_TIPS[blankOf(s)]),
}

export const PaymentsRuntimeContext =
  createContext<PaymentsRuntime>(shellRuntime)

export function usePaymentsRuntime(): PaymentsRuntime {
  return useContext(PaymentsRuntimeContext)
}
