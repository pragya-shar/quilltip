// @vitest-environment happy-dom
/**
 * The real `PaymentsEngine` and its controllers' `tip()`, mounted with a
 * stand-in Convex client and signer: two calls in one tick send one tip, a
 * call while sending sends nothing, and a press made before the engine
 * loaded is sent for the line it was made on, under its own request id.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getFunctionName } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { PaymentsEngine } from '../../components/payments/PaymentsEngine'
import { createOutbox, type OutboxEntry } from '../../lib/payments/outbox'
import { shellController, viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import type { TipController, TipTarget } from '../../lib/payments/types'
import { tokenNames } from './sessionToken'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({
  user: 'reader-1',
  /** What the signer was asked to send, in order. */
  sends: [] as {
    requestId: string
    articleId: string
    amountCents: number
    passage: unknown
  }[],
}))

// Stable answers, as Convex gives: the same object until the data changes.
const answers = vi.hoisted(() => {
  const at = Date.now()
  const cache = new Map<string, unknown>()
  const session = (user: string) => ({
    userId: user,
    sessionId: `session-${user}`,
    accountAddress: 'GREADER',
    network: 'testnet',
    wallet: { address: 'GREADER', verifiedAt: 1 },
    prices: [{ token: 'xlm', usd: 0.127328, at }],
    ledger: { sequence: 100, closedAt: at },
    settlement: { enabled: true, expectedWithinMs: 75_000 },
    status: 'open',
    tokens: [
      {
        token: 'xlm',
        contractId: 'C',
        confirmed: '200000000',
        outstanding: '0',
        available: '200000000',
        availableCents: 254,
      },
    ],
    availableCents: 254,
    pendingCents: 0,
    limits: {
      perTipCents: 500,
      dailyCents: 500,
      acceptedDay: '2026-11-28',
      acceptedTodayCents: 0,
      minTipCents: 10,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
    },
    devices: [
      {
        keyId: 1,
        publicKey: 'PUBLIC',
        validUntilLedger: 1_000_000,
        revoked: false,
      },
    ],
    recentRequestIds: [],
    onChain: true,
  })
  /** Per-test answers by function name, over the defaults. */
  const overrides = new Map<string, unknown>()
  return {
    overrides,
    of(name: string, user: string): unknown {
      if (overrides.has(name)) return overrides.get(name)
      const key = name === 'balance:session' ? `${name}:${user}` : name
      if (!cache.has(key))
        cache.set(
          key,
          name === 'balance:session'
            ? session(user)
            : name === 'balance:acceptedRequests'
              ? []
              : name === 'balance:tipContext'
                ? { tippable: true, reason: null, ownArticle: false }
                : undefined
        )
      return cache.get(key)
    },
    page: { results: [], status: 'Exhausted', loadMore: () => {} },
    auth: { isAuthenticated: true, isLoading: false },
  }
})

vi.mock('convex/react', () => ({
  useConvexAuth: () => answers.auth,
  useQuery: (fn: unknown, args: unknown) =>
    args === 'skip'
      ? undefined
      : answers.of(getFunctionName(fn as never), fake.user),
  usePaginatedQuery: () => answers.page,
  useMutation: () => async () => {
    throw new Error('the stand-in signer never calls the server')
  },
}))

// The signer the engine imports when idle: a ready device whose sends stay
// in flight, so a control stays `sending`.
vi.mock('@/lib/payments/live/signer', () => ({
  createSigner: (readerAddress: string) => ({
    scope: { tabContractId: 'CTAB', readerAddress },
    deviceState: async () => ({ state: 'ready', keyId: 1, view: 'ready' }),
    send: (entry: OutboxEntry) => {
      fake.sends.push({
        requestId: entry.requestId,
        articleId: entry.articleId,
        amountCents: entry.amountCents,
        passage: entry.passage,
      })
      return new Promise(() => {})
    },
  }),
}))

const ARTICLE = 'jh7777s11fpgcd26ntb8fzy45s8k1jkb' as Id<'articles'>
const meta = { articleTitle: 'An article', writerName: 'A writer', href: null }
const line = (text: string, start: number): TipTarget => ({
  kind: 'passage',
  articleId: ARTICLE,
  passage: { text, startOffset: start, endOffset: start + text.length },
})

let root: Root | null = null
let detach: (() => void) | null = null
let users = 0

async function mountEngine() {
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root!.render(h(PaymentsEngine)))
}

/** The engine's controller for `id`, once it can send. */
async function readyTip(id: string): Promise<TipController> {
  await vi.waitFor(
    () => {
      const s = paymentsStore.get()
      const tip = s.tips[id]
      expect({
        ready: tip?.ready,
        unavailable: tip?.unavailable,
        cents: tip?.amount?.cents,
        balance: s.balance?.status,
        device: s.balance?.device,
      }).toEqual({
        ready: true,
        unavailable: null,
        cents: 100,
        balance: 'ready',
        device: 'ready',
      })
    },
    { timeout: 3000 }
  )
  return paymentsStore.get().tips[id]!
}

/**
 * Lets the queue and any resend run, then reads what was sent: the signer's
 * sends, and this reader's outbox, where every tip the engine sends is put
 * first (the queue sends one at a time, so a second tip would wait there).
 */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300))
  })
  expect(createOutbox().list(fake.user)).toHaveLength(fake.sends.length)
  return fake.sends
}

function start() {
  // A fresh reader per test: the outbox and the queue are per user.
  fake.user = `reader-${++users}`
  fake.sends.length = 0
  detach = paymentsStore.attachShell()
  // The token names the pair the server answers for.
  tokenNames(pairOfReader())
  paymentsStore.setAuth('signed-in')
}

/** The pair the stand-in server answers for the reader in this test. */
const pairOfReader = () => `${fake.user}|session-${fake.user}`

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  for (const id of Object.keys(paymentsStore.get().registrations))
    paymentsStore.unregister(id)
  paymentsStore.setAuth('loading')
  window.localStorage.clear()
  paymentsStore.setSession(null)
  answers.overrides.clear()
  answers.auth.isAuthenticated = true
  detach?.()
  detach = null
  document.body.innerHTML = ''
})

/** The engine's controller for `id` once it has decided, ready or not. */
async function decided(id: string): Promise<TipController> {
  await vi.waitFor(
    () => expect(paymentsStore.get().tips[id]?.ready).toBe(true),
    {
      timeout: 3000,
    }
  )
  return paymentsStore.get().tips[id]!
}

const NOT_REGISTERED = {
  tippable: false,
  reason: 'not-tippable',
  ownArticle: false,
}

describe('an article that is not registered on chain', () => {
  it('is not tippable before any press, and a tap sends nothing', async () => {
    start()
    answers.overrides.set('balance:tipContext', NOT_REGISTERED)
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    const tip = await decided('control')
    expect(tip.unavailable).toBe('not-tippable')
    await act(async () => tip.tip())
    expect(await settle()).toHaveLength(0)
  })

  it('says so before anything about the reader’s own balance', async () => {
    start()
    answers.overrides.set('balance:tipContext', NOT_REGISTERED)
    answers.overrides.set('balance:session', {
      ...(answers.of('balance:session', fake.user) as object),
      status: 'none',
    })
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    expect((await decided('control')).unavailable).toBe('not-tippable')
  })

  it('offers no tip to a signed-out visitor either', async () => {
    start()
    answers.auth.isAuthenticated = false
    paymentsStore.setAuth('signed-out')
    answers.overrides.set('balance:tipContext', NOT_REGISTERED)
    answers.overrides.set('balance:publicTipTerms', {
      perTipCents: 500,
      minTipCents: 10,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
      priceUsd: 0.127328,
    })
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    const tip = await decided('control')
    expect(tip.unavailable).toBe('not-tippable')
    expect(tip.signedOut).toBeNull()
  })

  it('turns the control on when registration arrives, with no reload and nothing sent', async () => {
    start()
    answers.overrides.set('balance:tipContext', NOT_REGISTERED)
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    expect((await decided('control')).unavailable).toBe('not-tippable')
    // The live query answers again once the article is registered.
    answers.overrides.set('balance:tipContext', {
      tippable: true,
      reason: null,
      ownArticle: false,
    })
    await act(async () => root!.render(h(PaymentsEngine)))
    await vi.waitFor(() =>
      expect(paymentsStore.get().tips.control?.unavailable).toBeNull()
    )
    expect(await settle()).toHaveLength(0)
  })
})

describe('whose figures the engine publishes', () => {
  it('claims the store for its reader, so its figures show for that reader only', async () => {
    start()
    await mountEngine()
    await vi.waitFor(() =>
      expect(viewsOf(paymentsStore.get()).balance.status).toBe('ready')
    )
    expect(paymentsStore.get().owner).toBe(pairOfReader())
    // Another tab signs someone else in: nothing of this reader shows.
    await act(async () => tokenNames('someone-else|session-x'))
    expect(viewsOf(paymentsStore.get()).balance.status).toBe('loading')
  })
})

describe('PaymentsEngine tip()', () => {
  it('sends one tip for two calls in the same tick', async () => {
    start()
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    const tip = await readyTip('control')
    await act(async () => {
      void tip.tip()
      void tip.tip()
    })
    await vi.waitFor(() => expect(fake.sends).toHaveLength(1), {
      timeout: 3000,
    })
    expect(await settle()).toHaveLength(1)
    expect(paymentsStore.get().tips.control!.state.phase).toBe('sending')
  })

  it('sends nothing for a call while the tip is sending', async () => {
    start()
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    // Waited for outside `act`, which holds React updates until it ends.
    const tip = await readyTip('control')
    await act(async () => tip.tip())
    await vi.waitFor(() => expect(fake.sends).toHaveLength(1), {
      timeout: 3000,
    })
    const sending = paymentsStore.get().tips.control!
    expect(sending.state.phase).toBe('sending')
    await act(async () => sending.tip())
    expect(await settle()).toHaveLength(1)
  })

  it('says Offline for a press while offline, and is ready again online; nothing is sent', async () => {
    start()
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await mountEngine()
    const tip = await readyTip('control')
    const setOnline = async (online: boolean) => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => online,
      })
      await act(async () => {
        window.dispatchEvent(new Event(online ? 'online' : 'offline'))
      })
    }
    try {
      await setOnline(false)
      await act(async () => paymentsStore.get().tips.control!.tip())
      await vi.waitFor(() =>
        expect(paymentsStore.get().tips.control!.state.phase).toBe('offline')
      )
      await setOnline(true)
      await vi.waitFor(() =>
        expect(paymentsStore.get().tips.control!.state.phase).toBe('idle')
      )
      expect(await settle()).toHaveLength(0)
      expect(tip.amount?.cents).toBe(100)
    } finally {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      })
    }
  })

  it('sends a press made before it loaded for that line, not a later one', async () => {
    start()
    const lineA = line('Line A', 0)
    const lineB = line('Line B', 40)
    paymentsStore.register('control', { target: lineA, meta })
    // Pressed while the engine is not there yet: queued.
    await shellController('control').tip()
    const pressed = paymentsStore.get().queuedTaps.control!
    expect(pressed.target).toEqual(lineA)
    // The reader selects line B before the engine loads.
    paymentsStore.register('control', { target: lineB, meta })

    await mountEngine()
    await vi.waitFor(() => expect(fake.sends).toHaveLength(1), {
      timeout: 3000,
    })
    expect(await settle()).toHaveLength(1)
    expect(fake.sends[0]).toEqual({
      requestId: pressed.requestId,
      articleId: ARTICLE,
      amountCents: 100,
      passage: lineA.kind === 'passage' ? lineA.passage : null,
    })
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
  })

  it('sends nothing for a press made before it loaded when the amount pressed is not offered, and says so', async () => {
    start()
    // The reader's ladder tops out below the $1 on the button.
    const session = answers.of('balance:session', fake.user) as {
      limits: Record<string, unknown>
    }
    answers.overrides.set('balance:session', {
      ...session,
      limits: { ...session.limits, perTipCents: 50 },
    })
    paymentsStore.register('control', { target: line('Line A', 0), meta })
    await shellController('control').tip()
    expect(paymentsStore.get().queuedTaps.control?.cents).toBe(100)

    await mountEngine()
    await vi.waitFor(
      () => expect(paymentsStore.get().tips.control?.ready).toBe(true),
      { timeout: 3000 }
    )
    expect(await settle()).toHaveLength(0)
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
    expect(paymentsStore.get().tips.control?.missed).toBe(true)
  })
})
