// The money layer for the read suite: the layer's own types and fake
// (lib/payments/fake.ts) for every view, with the behaviour the suite
// checks on top: a tap sends once; "Sent" only after the fixture server
// accepted; a tip not yet answered is kept in an outbox and resent
// unchanged after a reload, and the server accepts a request id once; the
// connection is the browser's, and the control comes back with it (as the
// layer resets on `online`). The writer's page uses it too.
//
// `?pay=` picks a scenario. `needs-funds` and `no-price` are blocked before
// any press, as the layer answers (`blocked: 'balance' | 'price'`, no
// amount). `not-tippable` answers that the article is not registered.
import { useSyncExternalStore } from 'react'
import { fakePayments } from '../../../lib/payments/fake'
import { convertedMoney, money } from '../../../lib/payments/money'
import type {
  BalanceView,
  PaymentsRuntime,
  TipController,
  TipPhase,
  TipTarget,
  UnavailableReason,
} from '../../../lib/payments/types'
import type { BalanceReading } from '../../../shell/balance'

export type Scenario =
  | 'ready'
  | 'signed-out'
  | 'no-balance'
  | 'unavailable'
  | 'failed'
  | 'needs-funds'
  | 'no-price'
  | 'own-article'
  | 'not-tippable'
  | 'loading'

const params = new URLSearchParams(location.search)
export const scenario = (params.get('pay') ?? 'ready') as Scenario
const run = params.get('run') ?? 'default'
const OUTBOX = `read-fixture:outbox:${run}`

/**
 * The layer's base views: its signed-out offers (`offer=low`, today's cap
 * of about 64¢: 10¢, 25¢, 50¢; `offer=high`: $1 and up), loading and
 * unavailable; otherwise ready.
 */
const base = fakePayments(
  scenario === 'signed-out'
    ? params.get('offer') === 'high'
      ? 'signed-out-dollar'
      : 'signed-out'
    : scenario === 'loading'
      ? 'loading'
      : scenario === 'unavailable'
        ? 'unavailable'
        : 'ready'
)

type Sent = { requestId: string; cents: number; target: TipTarget }

let state = {
  cents: 100,
  // Short of the $1 default when blocked on the balance.
  available: scenario === 'needs-funds' ? 40 : 1840,
  online: navigator.onLine,
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

// The connection is the browser's. Back online, an offline tip control
// returns to idle, as the layer's controller does.
window.addEventListener('offline', () => set({ online: false }))
window.addEventListener('online', () =>
  set({
    online: true,
    ...(state.phase.phase === 'offline'
      ? { phase: { phase: 'idle' } as TipPhase }
      : {}),
  })
)

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
const LIMITS = {
  perTip: money(1000),
  dailyLeft: money(5000),
  minTip: money(10),
  defaultTip: money(100),
}

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
    case 'not-tippable':
      return 'not-tippable'
    default:
      return null
  }
}

const blocked: TipController['blocked'] =
  scenario === 'needs-funds'
    ? 'balance'
    : scenario === 'no-price'
      ? 'price'
      : null
/** No amount fits: loading, signed out, unavailable or blocked. */
const noAmount =
  blocked !== null ||
  scenario === 'loading' ||
  scenario === 'signed-out' ||
  scenario === 'unavailable'

async function tip(target: TipTarget) {
  if (state.phase.phase === 'sending' || noAmount) return
  const amount = money(state.cents)
  if (!state.online) return set({ phase: { phase: 'offline', amount } })
  if (state.cents > state.available)
    return set({
      phase: {
        phase: 'needs-funds',
        amount,
        available: convertedMoney(state.available),
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
    amount: noAmount ? null : money(state.cents),
    blocked,
    amounts: noAmount ? [] : AMOUNTS,
    setAmount: (cents) => set({ cents }),
    tip: () => tip(target),
    reset: () => set({ phase: { phase: 'idle' } }),
    ready: scenario !== 'loading',
    warming: false,
    queued: false,
    unavailable: unavailable(),
    // Always present: the layer's public offer while signed out, else null.
    signedOut: scenario === 'signed-out' ? base.tip.signedOut : null,
  }
}

function balanceView(s: typeof state): BalanceView {
  if (scenario === 'signed-out' || scenario === 'loading') return base.balance
  if (scenario === 'unavailable') return base.balance
  if (scenario === 'no-balance')
    return { ...base.balance, status: 'none', available: money(0), amounts: [] }
  return {
    ...base.balance,
    available: scenario === 'no-price' ? null : convertedMoney(s.available),
    price: scenario === 'no-price' ? null : base.balance.price,
    noAmountReason:
      scenario === 'no-price'
        ? 'price'
        : scenario === 'needs-funds'
          ? 'balance'
          : null,
    limits: LIMITS,
    amounts: noAmount ? [] : AMOUNTS,
    online: s.online,
  }
}

let cached: { key: unknown; target: TipTarget; value: TipController } | null =
  null
let cachedBalance: { key: unknown; value: BalanceView } | null = null

/** The layer's runtime (`PaymentsRuntime`), for `PaymentsRuntimeContext`. */
export const fakeRuntime: PaymentsRuntime = {
  useActivity: (role) =>
    role === 'reader' ? base.readerActivity : base.writerActivity,
  useEarnings: () => base.earnings,
  useBalance() {
    const s = useSyncExternalStore(subscribe, () => state)
    if (cachedBalance?.key !== s)
      cachedBalance = { key: s, value: balanceView(s) }
    return cachedBalance.value
  },
  useTip(target) {
    const s = useSyncExternalStore(subscribe, () => state)
    if (!cached || cached.key !== s || cached.target !== target)
      cached = { key: s, target, value: controller(target) }
    return cached.value
  },
}

/** The shell's balance item reads this. */
export function useFakeBalanceReading(): BalanceReading {
  const s = useSyncExternalStore(subscribe, () => state)
  if (scenario === 'signed-out')
    return { auth: 'signed-out', available: null, status: 'unavailable' }
  if (scenario === 'unavailable' || scenario === 'no-price')
    return { auth: 'signed-in', available: null, status: 'unavailable' }
  return {
    auth: 'signed-in',
    available: convertedMoney(s.available),
    status: 'ready',
  }
}
