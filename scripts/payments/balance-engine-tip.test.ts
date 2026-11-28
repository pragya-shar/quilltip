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
import { shellController } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import type { TipController, TipTarget } from '../../lib/payments/types'
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
  return {
    of(name: string, user: string): unknown {
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
  paymentsStore.setAuth('signed-in')
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  for (const id of Object.keys(paymentsStore.get().registrations))
    paymentsStore.unregister(id)
  paymentsStore.setAuth('loading')
  detach?.()
  detach = null
  document.body.innerHTML = ''
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
})
