// @vitest-environment happy-dom
/**
 * Figures and sends are bound to the pair the server answered for (user and
 * auth session), and shown only while this deployment's session token names
 * the same pair. First with the real `PaymentsShell` and `PaymentsEngine`
 * over a stand-in Convex client and signer; then each reader of the store
 * (the shell's balance item, the tip hook, the own-tips hook) on its own,
 * against a store that holds one pair's figures while the token names
 * another, as an engine without its own check would leave it.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getFunctionName } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { PaymentsShell } from '../../components/payments/PaymentsShell'
import { convertedMoney, money } from '../../lib/payments/money'
import type { OutboxEntry } from '../../lib/payments/outbox'
import {
  shellController,
  shellRuntime,
  viewsOf,
} from '../../lib/payments/runtime'
import { figuresShown, paymentsStore } from '../../lib/payments/store'
import type {
  BalanceView,
  OwnTipsView,
  TipController,
  TipTarget,
} from '../../lib/payments/types'
import { useLiveBalance } from '../../shell/liveBalance'
import { A, A_AGAIN, B, jwt, storageEvent, writeToken } from './sessionToken'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** Who the stand-in server answers for: `<userId>|<sessionId>`. */
const fake = vi.hoisted(() => ({
  pair: 'user-a|session-1',
  sends: [] as { requestId: string; userId: string }[],
}))

const answers = vi.hoisted(() => {
  const at = Date.now()
  const cache = new Map<string, unknown>()
  const session = (pair: string) => {
    const [userId, sessionId] = pair.split('|')
    return {
      userId,
      sessionId,
      accountAddress: `G${userId}`,
      network: 'testnet',
      wallet: { address: `G${userId}`, verifiedAt: 1 },
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
    }
  }
  return {
    of(name: string, pair: string): unknown {
      const key = name === 'balance:session' ? `${name}:${pair}` : name
      if (!cache.has(key))
        cache.set(
          key,
          name === 'balance:session'
            ? session(pair)
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
      : answers.of(getFunctionName(fn as never), fake.pair),
  usePaginatedQuery: () => answers.page,
  useMutation: () => async () => {
    throw new Error('the stand-in signer never calls the server')
  },
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/pocket' }))
vi.mock('@/lib/payments/live/signer', () => ({
  createSigner: (readerAddress: string) => ({
    scope: { tabContractId: 'CTAB', readerAddress },
    deviceState: async () => ({ state: 'ready', keyId: 1, view: 'ready' }),
    send: (entry: OutboxEntry) => {
      fake.sends.push({ requestId: entry.requestId, userId: entry.userId })
      return new Promise(() => {})
    },
  }),
}))

const ARTICLE = 'jh7777s11fpgcd26ntb8fzy45s8k1jkb' as Id<'articles'>
const meta = { articleTitle: 'An article', writerName: 'A writer', href: null }
const target: TipTarget = { kind: 'article', articleId: ARTICLE }

let root: Root | null = null
let detach: (() => void) | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  detach?.()
  detach = null
  for (const id of Object.keys(paymentsStore.get().registrations))
    paymentsStore.unregister(id)
  window.localStorage.clear()
  paymentsStore.setAuth('loading')
  paymentsStore.setSession(null)
  paymentsStore.set({ engine: 'idle', balance: null, ownTips: {}, tips: {} })
  fake.pair = A
  fake.sends.length = 0
  document.body.innerHTML = ''
})

const pause = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

/** The figure a screen reads, or null while hidden. */
const figure = () =>
  viewsOf(paymentsStore.get()).balance.available?.display ?? null

/** Another tab writes a token, and this tab hears its storage event. */
async function otherTabSignsIn(pair: string | null) {
  await act(async () => {
    writeToken(pair)
    storageEvent()
  })
}

/** The stand-in server answers for `pair` from now on (a live query's new
 * answer re-renders the engine). */
async function serverAnswersFor(pair: string) {
  fake.pair = pair
  await act(async () => root!.render(h(PaymentsShell)))
}

/** The real shell and engine, signed in as A, with one tip control ready. */
async function readyA() {
  writeToken(A)
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root!.render(h(PaymentsShell)))
  paymentsStore.register('control', { target, meta })
  await vi.waitFor(
    () => {
      const s = paymentsStore.get()
      expect(figure()).toBe('≈ $2.54')
      expect(s.tips.control?.ready).toBe(true)
      expect(s.tips.control?.unavailable).toBeNull()
    },
    { timeout: 4000 }
  )
  return paymentsStore.get().tips.control!
}

describe('the real shell and engine', () => {
  it('show A again after another tab signs in as B and then as A, with no reload', async () => {
    await readyA()
    // The engine is still answering for A throughout.
    await otherTabSignsIn(B)
    expect(figure()).toBeNull()
    await act(async () => shellRuntimeTip())
    await otherTabSignsIn(A)
    await vi.waitFor(() => expect(figure()).toBe('≈ $2.54'), {
      timeout: 1500,
    })
    // The press made under B is never sent for A.
    await pause(300)
    expect(fake.sends).toHaveLength(0)
    expect(paymentsStore.get().queuedTaps).toEqual({})
    // A's own press now is sent once.
    await act(async () => paymentsStore.get().tips.control!.tip())
    await pause(300)
    expect(fake.sends).toEqual([
      { requestId: expect.any(String), userId: 'user-a' },
    ])
  })

  it('show A’s new session once the engine answers for it', async () => {
    await readyA()
    await otherTabSignsIn(B)
    await serverAnswersFor(B)
    await vi.waitFor(() => expect(paymentsStore.get().owner).toBe(B))
    await otherTabSignsIn(A_AGAIN)
    expect(figure()).toBeNull()
    await serverAnswersFor(A_AGAIN)
    await vi.waitFor(() => expect(figure()).toBe('≈ $2.54'), {
      timeout: 1500,
    })
    expect(paymentsStore.get().owner).toBe(A_AGAIN)
  })

  it('show A’s figures when another deployment left a token, listed first', async () => {
    window.localStorage.setItem('__convexAuthJWT_aaaolddeployment', jwt(B))
    await readyA()
    expect(figure()).toBe('≈ $2.54')
  })

  it('hide A’s figures on focus after the token changed with no event', async () => {
    await readyA()
    writeToken(B)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(figure()).toBeNull()
    expect(figuresShown(paymentsStore.get())).toBe(false)
  })

  it('send nothing from a controller held across a token change no event announced', async () => {
    const held = await readyA()
    writeToken(B)
    await act(async () => held.tip())
    await pause(300)
    expect(fake.sends).toHaveLength(0)
  })

  it('publish no controller for A while the token names B', async () => {
    await readyA()
    await otherTabSignsIn(B)
    await pause(300)
    expect(paymentsStore.get().tips.control).toBeUndefined()
    expect(paymentsStore.get().balance).toBeNull()
  })

  it('hide the figures when the token is removed while auth still reads signed in', async () => {
    await readyA()
    await otherTabSignsIn(null)
    await pause(100)
    expect(figure()).toBeNull()
  })
})

/** The press a control makes before the engine has a controller for it. */
async function shellRuntimeTip() {
  const id = Object.keys(paymentsStore.get().registrations)[0]!
  await shellController(id).tip()
}

describe('each reader of the store checks the binding itself', () => {
  const BALANCE: BalanceView = {
    status: 'ready',
    available: convertedMoney(254),
    pending: money(0),
    deviceReady: true,
    device: 'ready',
    limits: null,
    amounts: [],
    noAmountReason: null,
    settlement: { enabled: true, expectedWithinMs: 1 },
    online: true,
    network: 'testnet',
  }
  const OWN: OwnTipsView = { status: 'ready', tips: [], complete: true }

  /** A's figures in the store while the token names B: what an engine with
   * no check of its own would leave. */
  function heldForAUnderB() {
    detach = paymentsStore.attachShell()
    writeToken(A)
    paymentsStore.readSession()
    paymentsStore.setAuth('signed-in')
    paymentsStore.claim(A)
    writeToken(B)
    paymentsStore.readSession()
    paymentsStore.claim(A)
  }

  async function render<T>(use: () => T): Promise<() => T> {
    let last: T
    function Probe() {
      last = use()
      return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(h(Probe)))
    return () => last
  }

  it('the shell’s balance item shows no figure', async () => {
    heldForAUnderB()
    const read = await render(useLiveBalance)
    await act(async () => paymentsStore.set({ balance: BALANCE }))
    expect(read()).toEqual({
      auth: 'signed-in',
      available: null,
      status: 'loading',
    })
  })

  it('the tip hook hands out no controller of A’s', async () => {
    heldForAUnderB()
    const read = await render(() => shellRuntime.useTip(target, meta))
    const id = Object.keys(paymentsStore.get().registrations)[0]!
    const forA = { ready: true, warming: false } as TipController
    await act(async () => paymentsStore.set({ tips: { [id]: forA } }))
    expect(read()).not.toBe(forA)
    expect(read().warming).toBe(true)
  })

  it('the own-tips hook shows none of A’s tips', async () => {
    heldForAUnderB()
    const read = await render(() => shellRuntime.useOwnTips(ARTICLE))
    await act(async () => paymentsStore.set({ ownTips: { [ARTICLE]: OWN } }))
    expect(read()).not.toBe(OWN)
    expect(read().status).toBe('loading')
  })
})
