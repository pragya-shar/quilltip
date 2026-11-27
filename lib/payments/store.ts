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

const ONE: Money = { cents: 100, display: '$1.00' }

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed'
export type AuthState = 'loading' | 'signed-out' | 'signed-in'

export type TipRegistration = { target: TipTarget; meta: TipMeta }

/** A press made before the engine was ready, as it was at press time. */
export type QueuedTap = TipRegistration & { cents: number; requestId: string }

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
  queuedTaps: Record<string, QueuedTap>
  watches: { writer: number; earnings: number }
  /** Mounted payments shells (the root layout mounts one). */
  shells: number
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
const LOADING_ACTIVITY: ActivityView = {
  status: 'loading',
  items: [],
  canLoadMore: false,
  loadMore: () => {},
}
const LOADING_EARNINGS: EarningsView = {
  status: 'loading',
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
  shells: 0,
}

const listeners = new Set<() => void>()
let engineWanted: (() => void) | null = null

function set(patch: Partial<PaymentsState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** A signed-out visitor's tip control needs the engine for its amounts. */
function wantPublic() {
  if (state.auth === 'signed-out' && Object.keys(state.registrations).length)
    engineWanted?.()
}

/**
 * The controller a control shows before the engine computed one. With no
 * shell on the page nothing will answer, so the control says so at once
 * (`absent`) and a host keeps its other tip path instead of waiting.
 */
export function shellController(id: string): TipController {
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
      const reg = state.registrations[id]
      if (absent || signedOut || failed || !reg || id in state.queuedTaps)
        return
      // Not lost: the engine sends it once, when ready, for what was pressed:
      // this target and amount, under this request id.
      set({
        queuedTaps: {
          ...state.queuedTaps,
          [id]: { ...reg, cents: ONE.cents, requestId: crypto.randomUUID() },
        },
      })
      engineWanted?.()
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

export const paymentsStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  set,
  /** Called by `PaymentsShell` on mount; returns the unmount call. */
  attachShell() {
    set({ shells: state.shells + 1 })
    return () => set({ shells: state.shells - 1 })
  },
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
    wantPublic()
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
    wantPublic()
  },
  unregister(id: string) {
    const { [id]: _gone, ...rest } = state.registrations
    const { [id]: _tip, ...tips } = state.tips
    const { [id]: _tap, ...queuedTaps } = state.queuedTaps
    set({ registrations: rest, tips, queuedTaps })
  },
  /** Takes a queued tap once; the engine calls it when a control is ready. */
  takeTap(id: string): QueuedTap | undefined {
    const tap = state.queuedTaps[id]
    if (!tap) return undefined
    const { [id]: _taken, ...rest } = state.queuedTaps
    set({ queuedTaps: rest })
    return tap
  },
  watch(kind: 'writer' | 'earnings') {
    set({ watches: { ...state.watches, [kind]: state.watches[kind] + 1 } })
    return () =>
      set({ watches: { ...state.watches, [kind]: state.watches[kind] - 1 } })
  },
}
