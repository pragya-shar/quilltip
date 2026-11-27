'use client'

/**
 * The payments shell's store: the only payments code in a first load. The
 * root layout mounts `PaymentsShell`, which keeps this store in step with
 * the auth state and loads the engine (`components/payments/PaymentsEngine`)
 * with `import()` once the visitor is signed in, or shows tip intent. The
 * engine writes the views here; the hooks (`hooks/payments/*`) read them, so
 * a screen's hooks never change when the engine arrives.
 *
 * A tap before the engine is ready is queued per control and acted on once
 * when the engine is ready (`takeTap`), so it is never lost and never sent
 * twice. Nothing here imports Convex, the outbox, the tip machine or the
 * signer.
 */
import type {
  ActivityView,
  BalanceView,
  EarningsView,
  Money,
  TipController,
  TipMeta,
  TipTarget,
} from './types'

const ZERO: Money = { cents: 0, display: '$0.00' }
const ONE: Money = { cents: 100, display: '$1.00' }

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed'
export type AuthState = 'loading' | 'signed-out' | 'signed-in'

export type TipRegistration = { target: TipTarget; meta: TipMeta }

export type PaymentsState = {
  auth: AuthState
  engine: EngineState
  balance: BalanceView
  readerActivity: ActivityView
  writerActivity: ActivityView
  earnings: EarningsView
  /** Controllers the engine computed, by control id. */
  tips: Record<string, TipController>
  /** Live controls and what they tip, for the engine. */
  registrations: Record<string, TipRegistration>
  /** Taps made before the engine was ready, by control id. */
  queuedTaps: Record<string, number>
  watches: { writer: number; earnings: number }
}

const LOADING_BALANCE: BalanceView = {
  status: 'loading',
  available: ZERO,
  pending: ZERO,
  deviceReady: false,
  device: 'loading',
  limits: null,
  amounts: [],
  noAmountReason: null,
  settlement: { enabled: false, expectedWithinMs: 0 },
  online: true,
  network: 'testnet',
}
const LOADING_ACTIVITY: ActivityView = {
  status: 'loading',
  items: [],
  canLoadMore: false,
  loadMore: () => {},
}
const LOADING_EARNINGS: EarningsView = {
  status: 'loading',
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

let state: PaymentsState = {
  auth: 'loading',
  engine: 'idle',
  balance: LOADING_BALANCE,
  readerActivity: LOADING_ACTIVITY,
  writerActivity: LOADING_ACTIVITY,
  earnings: LOADING_EARNINGS,
  tips: {},
  registrations: {},
  queuedTaps: {},
  watches: { writer: 0, earnings: 0 },
}

const listeners = new Set<() => void>()
let engineWanted: (() => void) | null = null

function set(patch: Partial<PaymentsState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** The controller a control shows before the engine computed one. */
export function shellController(id: string): TipController {
  const signedOut = state.auth === 'signed-out'
  const failed = state.engine === 'failed'
  return {
    state: { phase: 'idle' },
    amount: ONE,
    blocked: null,
    amounts: [],
    setAmount: () => {},
    tip: async () => {
      if (signedOut || failed) return
      // Not lost: the engine acts on it once, when it is ready.
      set({ queuedTaps: { ...state.queuedTaps, [id]: Date.now() } })
      engineWanted?.()
    },
    reset: () => {},
    ready: signedOut || failed,
    warming: state.auth === 'signed-in' && !failed,
    queued: id in state.queuedTaps,
    unavailable: signedOut ? 'signed-out' : failed ? 'not-loaded' : null,
  }
}

export const paymentsStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  set,
  setAuth(auth: AuthState) {
    if (auth === state.auth) return
    // Nothing of one reader is shown to the next.
    set({
      auth,
      balance:
        auth === 'signed-out'
          ? { ...LOADING_BALANCE, status: 'signed-out', device: 'unavailable' }
          : LOADING_BALANCE,
      readerActivity: LOADING_ACTIVITY,
      writerActivity: LOADING_ACTIVITY,
      earnings:
        auth === 'signed-out'
          ? { ...LOADING_EARNINGS, status: 'signed-out' }
          : LOADING_EARNINGS,
      tips: {},
      queuedTaps: {},
    })
  },
  /** The engine failed: every view reads unavailable until it recovers. */
  fail() {
    set({
      engine: 'failed',
      balance: {
        ...LOADING_BALANCE,
        status: 'unavailable',
        device: 'unavailable',
      },
      readerActivity: { ...LOADING_ACTIVITY, status: 'unavailable' },
      writerActivity: { ...LOADING_ACTIVITY, status: 'unavailable' },
      earnings: { ...LOADING_EARNINGS, status: 'unavailable' },
      tips: {},
      queuedTaps: {},
    })
  },
  /** The shell's loader, called on tip intent before sign-in is known. */
  onEngineWanted(load: () => void) {
    engineWanted = load
  },
  wantEngine() {
    engineWanted?.()
  },
  /** Adds or updates a control; its computed controller stays. */
  register(id: string, registration: TipRegistration) {
    set({ registrations: { ...state.registrations, [id]: registration } })
  },
  unregister(id: string) {
    const { [id]: _gone, ...rest } = state.registrations
    const { [id]: _tip, ...tips } = state.tips
    const { [id]: _tap, ...queuedTaps } = state.queuedTaps
    set({ registrations: rest, tips, queuedTaps })
  },
  /** Takes a queued tap once; the engine calls it when a control is ready. */
  takeTap(id: string): boolean {
    if (!(id in state.queuedTaps)) return false
    const { [id]: _taken, ...rest } = state.queuedTaps
    set({ queuedTaps: rest })
    return true
  },
  watch(kind: 'writer' | 'earnings') {
    set({ watches: { ...state.watches, [kind]: state.watches[kind] + 1 } })
    return () =>
      set({ watches: { ...state.watches, [kind]: state.watches[kind] - 1 } })
  },
}
