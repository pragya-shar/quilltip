'use client'

/**
 * The payments shell's store: the only payments code in a first load, so it
 * holds state and nothing else. The root layout mounts `PaymentsShell`, which
 * keeps this store in step with the auth state and loads the engine
 * (`components/payments/PaymentsEngine`) with `import()` once the visitor is
 * signed in, or shows tip intent. The engine writes the views here; the hooks
 * (`hooks/payments/*`, through `runtime.ts`, which loads with the screens)
 * read them, so a screen's hooks never change when the engine arrives. A view
 * the engine has not written is `null`; the runtime shows the blank view for
 * the auth and engine state in its place.
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
  OwnTipsView,
  TipController,
  TipMeta,
  TipTarget,
} from './types'

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed'
export type AuthState = 'loading' | 'signed-out' | 'signed-in'

export type TipRegistration = { target: TipTarget; meta: TipMeta }

/** A press made before the engine was ready, as it was at press time. */
export type QueuedTap = TipRegistration & { cents: number; requestId: string }

export type PaymentsState = {
  auth: AuthState
  engine: EngineState
  /** Written by the engine; `null` until it has written them. */
  balance: BalanceView | null
  readerActivity: ActivityView | null
  writerActivity: ActivityView | null
  earnings: EarningsView | null
  /** The reader's own tips, by article id, for articles with a control. */
  ownTips: Record<string, OwnTipsView>
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

// Nothing of one reader is shown to the next, or after a failure.
const CLEARED = {
  balance: null,
  readerActivity: null,
  writerActivity: null,
  earnings: null,
  ownTips: {},
  tips: {},
  queuedTaps: {},
}

let state: PaymentsState = {
  auth: 'loading',
  engine: 'idle',
  ...CLEARED,
  registrations: {},
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
    set({ auth, ...CLEARED })
    wantPublic()
  },
  /** The engine failed: every view reads unavailable until it recovers. */
  fail() {
    set({ engine: 'failed', ...CLEARED })
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
  /** Queues a press once per control; the engine takes it when ready. */
  queueTap(id: string, tap: QueuedTap) {
    if (id in state.queuedTaps) return
    set({ queuedTaps: { ...state.queuedTaps, [id]: tap } })
    engineWanted?.()
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
