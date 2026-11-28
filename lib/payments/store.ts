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
 * when the engine is ready (`takeTap`), so it is never sent twice. It waits
 * at most `TAP_WAIT_MS`: past that it is dropped, and the control says
 * nothing was sent until the next press (`missedTaps`), so a tip never goes
 * seconds after the reader moved on. Nothing here imports Convex, the outbox, the tip machine or the
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
import { tokenPair } from './owner'

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed'
export type AuthState = 'loading' | 'signed-out' | 'signed-in'

export type TipRegistration = { target: TipTarget; meta: TipMeta }

/** A press made before the engine was ready, as it was at press time
 * (`at`, from `Date.now()`), and the user and session it was made in
 * (`pair`, from the session token). */
export type QueuedTap = TipRegistration & {
  cents: number
  requestId: string
  at: number
  pair: string
}

/** How long a press made before the engine was ready may wait for it. */
export const TAP_WAIT_MS = 3000

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
  /** Controls whose early tap waited too long and was dropped: nothing was
   * sent, and the control says so until its next press. */
  missedTaps: Record<string, true>
  watches: { writer: number; earnings: number }
  /** Mounted payments shells (the root layout mounts one). */
  shells: number
  /** The user and session the server answered for, `<userId>|<sessionId>`,
   * claimed by the engine (`claim`) before it publishes; null when none. */
  owner: string | null
  /** The pair in this deployment's session token, as last read
   * (`readSession`); null when there is none or it cannot be read. */
  session: string | null
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
  missedTaps: {},
  owner: null,
}

let state: PaymentsState = {
  auth: 'loading',
  engine: 'idle',
  ...CLEARED,
  registrations: {},
  watches: { writer: 0, earnings: 0 },
  shells: 0,
  session: null,
}

const listeners = new Set<() => void>()
const tapTimers = new Map<string, ReturnType<typeof setTimeout>>()
let engineWanted: (() => void) | null = null
let retryLoad: (() => void) | null = null

/**
 * Whether the figures in `s` may be shown. Signed in, they must have been
 * claimed for the pair the server answered for (`claim`), and this
 * deployment's session token must name the same pair. No token, a token
 * that does not parse, or another pair: hidden, so after another tab signs
 * in as someone else (or signs in again), the last figures stay hidden
 * until the engine claims the store for the new pair. Signed out or
 * loading, the store holds no one's figures.
 */
export function figuresShown(s: PaymentsState): boolean {
  if (s.auth !== 'signed-in') return true
  return s.owner !== null && s.session === s.owner
}

/**
 * Whether the engine answering for `pair` (null: no one signed in) may
 * publish, send and take taps now. Signed in: the store is claimed for that
 * pair and the session token names it. Otherwise only for no one.
 */
export function bindingHolds(s: PaymentsState, pair: string | null): boolean {
  if (s.auth !== 'signed-in') return pair === null
  return pair !== null && s.owner === pair && s.session === pair
}

/** Taps made in `pair`'s session; the others are dropped. */
function tapsOf(pair: string | null) {
  const queuedTaps: Record<string, QueuedTap> = {}
  for (const [id, tap] of Object.entries(state.queuedTaps))
    if (tap.pair === pair) queuedTaps[id] = tap
  return queuedTaps
}

function set(patch: Partial<PaymentsState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

/** Drops a queued tap that waited past `TAP_WAIT_MS`, and marks it missed. */
function dropLate(id: string, requestId: string) {
  const tap = state.queuedTaps[id]
  if (!tap || tap.requestId !== requestId) return
  const { [id]: _late, ...queuedTaps } = state.queuedTaps
  set({ queuedTaps, missedTaps: { ...state.missedTaps, [id]: true } })
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
  /**
   * The pair in this deployment's session token now. Figures held for any
   * other pair go at once, before the auth library or the engine has caught
   * up, and so do taps made in another session.
   */
  setSession(session: string | null) {
    if (session === state.session) return
    const stale = state.owner !== null && state.owner !== session
    set({
      ...(stale ? CLEARED : {}),
      queuedTaps: tapsOf(session),
      session,
    })
  },
  /**
   * Reads the session token now (`setSession`). `PaymentsShell` calls it on
   * mount, on each auth change, when another tab changes the token, on focus,
   * when the page is shown again; the engine and the store call it before
   * every send and every taken tap.
   */
  readSession() {
    paymentsStore.setSession(tokenPair())
  },
  /**
   * Whether the engine answering for `pair` may send now: the token is read
   * again first, so a change no event announced is seen.
   */
  bound(pair: string | null): boolean {
    paymentsStore.readSession()
    return bindingHolds(state, pair)
  },
  /**
   * The engine is about to publish figures for the pair the server answered
   * for. Anything held for another pair goes first; taps stay only when
   * they were made in this pair's session.
   */
  claim(owner: string) {
    if (state.owner === owner) return
    const queuedTaps = tapsOf(owner)
    set({
      ...CLEARED,
      queuedTaps,
      missedTaps: state.owner === null ? state.missedTaps : {},
      owner,
    })
  },
  setAuth(auth: AuthState) {
    if (auth === state.auth) return
    set({ auth, ...CLEARED })
    wantPublic()
  },
  /**
   * The engine failed: every view reads unavailable until it recovers. Whose
   * figures they were is kept, so the balance still knows whether this
   * person writes; a change of session clears it (`setSession`).
   */
  fail() {
    set({ engine: 'failed', ...CLEARED, owner: state.owner })
  },
  /** Whoever loads payments now registers how to load them again; returns
   * the unregister call. */
  onRetry(load: () => void) {
    retryLoad = load
    return () => {
      if (retryLoad === load) retryLoad = null
    }
  },
  /** "Try again": loads payments again now, if they failed. */
  retry() {
    retryLoad?.()
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
    const { [id]: _missed, ...missedTaps } = state.missedTaps
    clearTimeout(tapTimers.get(id))
    tapTimers.delete(id)
    set({ registrations: rest, tips, queuedTaps, missedTaps })
  },
  /**
   * Queues a press once per control; the engine takes it when ready, within
   * `TAP_WAIT_MS`. A second press while one waits does nothing.
   */
  queueTap(id: string, tap: QueuedTap) {
    if (id in state.queuedTaps) return
    const { [id]: _missed, ...missedTaps } = state.missedTaps
    set({ queuedTaps: { ...state.queuedTaps, [id]: tap }, missedTaps })
    clearTimeout(tapTimers.get(id))
    tapTimers.set(
      id,
      setTimeout(
        () => dropLate(id, tap.requestId),
        Math.max(0, tap.at + TAP_WAIT_MS - Date.now())
      )
    )
    engineWanted?.()
  },
  /**
   * Takes a queued tap once, for the engine answering for `pair`, when a
   * control is ready: only while the binding holds (the token is read again
   * first) and only a tap made in that pair's session; one made in another
   * is dropped. A late one is dropped and marked missed (a timer can run
   * late in a hidden tab).
   */
  takeTap(id: string, pair: string | null): QueuedTap | undefined {
    if (!paymentsStore.bound(pair)) return undefined
    const tap = state.queuedTaps[id]
    if (!tap) return undefined
    if (tap.pair !== pair) {
      const { [id]: _other, ...rest } = state.queuedTaps
      set({ queuedTaps: rest })
      return undefined
    }
    if (Date.now() - tap.at > TAP_WAIT_MS) {
      dropLate(id, tap.requestId)
      return undefined
    }
    const { [id]: _taken, ...rest } = state.queuedTaps
    set({ queuedTaps: rest })
    return tap
  },
  /** The control was pressed again: it no longer says nothing was sent. */
  clearMissed(id: string) {
    if (!(id in state.missedTaps)) return
    const { [id]: _missed, ...missedTaps } = state.missedTaps
    set({ missedTaps })
  },
  watch(kind: 'writer' | 'earnings') {
    set({ watches: { ...state.watches, [kind]: state.watches[kind] + 1 } })
    return () =>
      set({ watches: { ...state.watches, [kind]: state.watches[kind] - 1 } })
  },
}
