// A fake of the money hooks for the read suite, with the interface of
// hooks/payments (pull request 561: lib/payments/README.md and types.ts),
// and the behaviour the suite checks: a tap sends once; "Sent" only after
// the fixture server accepted; a tip not yet answered is kept in an outbox
// and resent unchanged after a reload, and the server accepts a request id
// once. It is written for the suite, not copied from the money layer.
import { useSyncExternalStore } from 'react'
import {
  signedOutOfferFor,
  type BalanceView,
  type Money,
  type ReadPaymentsRuntime,
  type TipController,
  type TipPhase,
  type TipTarget,
  type UnavailableReason,
} from '../../../hooks/read/payments'
import type { BalanceReading } from '../../../shell/balance'

export type Scenario =
  | 'ready'
  | 'signed-out'
  | 'no-balance'
  | 'unavailable'
  | 'offline'
  | 'failed'
  | 'needs-funds'
  | 'own-article'
  | 'loading'

const params = new URLSearchParams(location.search)
export const scenario = (params.get('pay') ?? 'ready') as Scenario
const run = params.get('run') ?? 'default'
/**
 * The per-tip cap a signed-out visitor's offer is cut to: `low` is today's
 * testnet (about 64¢: 10¢, 25¢, 50¢), `high` a cap of $10 ($1 and up).
 */
const OFFER_CAPS = { low: 64, high: 1000 } as const
const offerCap =
  OFFER_CAPS[(params.get('offer') ?? 'low') as keyof typeof OFFER_CAPS] ??
  OFFER_CAPS.low
const OUTBOX = `read-fixture:outbox:${run}`

const money = (cents: number): Money => ({
  cents,
  display: cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`,
})

type Sent = { requestId: string; cents: number; target: TipTarget }

let state = {
  cents: 100,
  available: scenario === 'needs-funds' ? 40 : 1840,
  phase: { phase: 'idle' } as TipPhase,
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const set = (next: Partial<typeof state>) => {
  state = { ...state, ...next }
  emit()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readOutbox(): Sent[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Sent[]
  } catch {
    return []
  }
}
function writeOutbox(entries: Sent[]) {
  localStorage.setItem(OUTBOX, JSON.stringify(entries))
}

async function post(entry: Sent): Promise<boolean> {
  const response = await fetch(`/api/tips?run=${run}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
  return response.ok
}

/** Sends what a reload interrupted, unchanged; the server dedupes. */
async function flushOutbox() {
  for (const entry of readOutbox()) {
    // Removed once the server answered, whatever it said.
    if (
      await post(entry).then(
        () => true,
        () => false
      )
    )
      writeOutbox(readOutbox().filter((e) => e.requestId !== entry.requestId))
  }
}
void flushOutbox()

const AMOUNTS = [100, 200, 300, 500, 1000].map(money)

function unavailable(): UnavailableReason | null {
  switch (scenario) {
    case 'signed-out':
      return 'signed-out'
    case 'no-balance':
      return 'no-balance'
    case 'unavailable':
      return 'not-loaded'
    case 'own-article':
      return 'own-article'
    default:
      return null
  }
}

async function tip(target: TipTarget) {
  if (state.phase.phase === 'sending') return
  const amount = money(state.cents)
  if (scenario === 'offline')
    return set({ phase: { phase: 'offline', amount } })
  if (state.cents > state.available)
    return set({
      phase: {
        phase: 'needs-funds',
        amount,
        available: money(state.available),
      },
    })
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const entry: Sent = { requestId, cents: state.cents, target }
  writeOutbox([...readOutbox(), entry])
  set({ phase: { phase: 'sending', requestId, amount } })
  let ok: boolean
  try {
    ok = scenario === 'failed' ? false : await post(entry)
  } catch {
    // No answer (a reload, a lost connection): the outcome is unknown, so
    // the tip stays in the outbox and stays "Sending".
    return
  }
  writeOutbox(readOutbox().filter((e) => e.requestId !== requestId))
  if (!ok) return set({ phase: { phase: 'failed', code: 'FIXTURE', amount } })
  set({
    available: state.available - entry.cents,
    phase: { phase: 'sent', requestId, amount },
  })
}

function controller(target: TipTarget): TipController {
  return {
    state: state.phase,
    amount: scenario === 'loading' ? null : money(state.cents),
    blocked: null,
    amounts: scenario === 'loading' ? [] : AMOUNTS,
    setAmount: (cents) => set({ cents }),
    tip: () => tip(target),
    reset: () => set({ phase: { phase: 'idle' } }),
    ready: scenario !== 'loading',
    warming: false,
    queued: false,
    unavailable: unavailable(),
    // The public default for a signed-out visitor (minimum, cap, price).
    signedOut:
      scenario === 'signed-out'
        ? signedOutOfferFor({ minCents: 10, perTipCents: offerCap })
        : null,
  }
}

let cached: { key: unknown; value: TipController } | null = null

export const fakeRuntime: ReadPaymentsRuntime = {
  useBalance(): BalanceView {
    const s = useSyncExternalStore(subscribe, () => state)
    return {
      status: scenario === 'signed-out' ? 'signed-out' : 'ready',
      available: money(s.available),
      online: scenario !== 'offline',
    }
  },
  useTip(target) {
    const s = useSyncExternalStore(subscribe, () => state)
    if (!cached || cached.key !== s || cachedTarget !== target) {
      cachedTarget = target
      cached = { key: s, value: controller(target) }
    }
    return cached.value
  },
}
let cachedTarget: TipTarget | null = null

/** The shell's balance item and the tip bar's caption read this. */
export function useFakeBalanceReading(): BalanceReading {
  const s = useSyncExternalStore(subscribe, () => state)
  if (scenario === 'signed-out')
    return { auth: 'signed-out', available: null, status: 'unavailable' }
  if (scenario === 'unavailable')
    return { auth: 'signed-in', available: null, status: 'unavailable' }
  return { auth: 'signed-in', available: money(s.available), status: 'ready' }
}
