// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { writerMemory } from '../../components/pocket/writerMemory'
import { convertedMoney, money } from '../../lib/payments/money'
import { shellController, viewsOf } from '../../lib/payments/runtime'
import {
  figuresShown,
  paymentsStore,
  tokenKey,
  tokenPair,
} from '../../lib/payments/store'
import type {
  BalanceView,
  EarningsView,
  TipTarget,
} from '../../lib/payments/types'
import type { Id } from '../../convex/_generated/dataModel'
import { cleanups } from '../../shell/signOut/pocket'
import { A, A_AGAIN, B, jwt, tokenNames, writeToken } from './sessionToken'

// The payments store holds the figures of one pair the server answered for
// (user and auth session). Nobody else reads them: not after sign-out, and
// not after the account or the session changes in another tab with no
// reload, before the new pair's own figures arrive.

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
const EARNINGS: EarningsView = {
  status: 'ready',
  isWriter: true,
  pending: money(0),
  available: money(975),
  collected: money(0),
  total: money(975),
  onHold: money(0),
  notPaid: money(0),
  counts: null,
  lagging: false,
  exact: null,
}

/** Reader A's figures, published by an engine under the one shell, which
 * stays mounted for the whole visit. */
function readerA() {
  const detach = paymentsStore.attachShell()
  tokenNames(A)
  paymentsStore.setAuth('signed-in')
  paymentsStore.claim(A)
  paymentsStore.set({ engine: 'ready', balance: BALANCE, earnings: EARNINGS })
  return detach
}

const shown = () => {
  const views = viewsOf(paymentsStore.get())
  return {
    balance: views.balance.available?.display ?? null,
    earnings: views.earnings.available?.display ?? null,
  }
}

const meta = { articleTitle: 'An article', writerName: 'A writer', href: null }
const target: TipTarget = {
  kind: 'article',
  articleId: 'jh7777s11fpgcd26ntb8fzy45s8k1jkb' as Id<'articles'>,
}

let detaches: (() => void)[] = []
afterEach(() => {
  for (const detach of detaches) detach()
  detaches = []
  paymentsStore.unregister('control')
  paymentsStore.setAuth('loading')
  window.localStorage.clear()
  paymentsStore.setSession(null)
  paymentsStore.set({ engine: 'idle' })
  writerMemory.forget()
})

/** The balance the shell's bar shows, read as shell/liveBalance.ts reads
 * it (its own test renders it: balance-binding.test.ts). */
const liveFigure = () => {
  const s = paymentsStore.get()
  return figuresShown(s) ? s.balance : null
}

describe('the last reader’s figures', () => {
  it('go when another tab signs in as someone else, with the shell still mounted', () => {
    detaches.push(readerA())
    expect(shown()).toEqual({ balance: '≈ $2.54', earnings: '$9.75' })
    // Another tab signs B in: the token changes; auth reads signed in
    // throughout, and this tab's engine has not answered for B yet.
    tokenNames(B)
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(paymentsStore.get().owner).toBeNull()
  })

  it('stay hidden while the engine still answers for the last reader', () => {
    detaches.push(readerA())
    tokenNames(B)
    // The engine, still authenticated as A, claims and publishes again.
    paymentsStore.claim(A)
    paymentsStore.set({ balance: BALANCE, earnings: EARNINGS })
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(liveFigure()).toBeNull()
    // Once it answers for B, B's own figures show.
    paymentsStore.claim(B)
    expect(shown()).toEqual({ balance: null, earnings: null })
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('are never shown unclaimed while signed in', () => {
    detaches.push(paymentsStore.attachShell())
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.set({ engine: 'ready', balance: BALANCE, earnings: EARNINGS })
    expect(shown()).toEqual({ balance: null, earnings: null })
    paymentsStore.claim(A)
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('stay for the same reader', () => {
    detaches.push(readerA())
    tokenNames(A)
    paymentsStore.claim(A)
    expect(shown()).toEqual({ balance: '≈ $2.54', earnings: '$9.75' })
  })

  it('go when the engine publishes for someone else', () => {
    detaches.push(readerA())
    tokenNames(null)
    paymentsStore.claim(B)
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(paymentsStore.get().owner).toBe(B)
  })

  it('go on sign-out, with whether the last person writes', async () => {
    detaches.push(readerA())
    writerMemory.set(A, true)
    await Promise.all(cleanups.map((cleanup) => cleanup.run()))
    expect(paymentsStore.get().auth).toBe('signed-out')
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(writerMemory.get(A)).toBeNull()
  })

  it('whether someone writes is remembered for that account only', () => {
    writerMemory.set(A, true)
    expect(writerMemory.get(A)).toBe(true)
    expect(writerMemory.get(A_AGAIN)).toBe(true)
    expect(writerMemory.get(B)).toBeNull()
  })
})

describe('an outage', () => {
  it('keeps whose figures they were, so a writer stays a writer, and shows none', () => {
    detaches.push(readerA())
    writerMemory.set(A, true)
    paymentsStore.fail()
    expect(paymentsStore.get().owner).toBe(A)
    expect(writerMemory.get(paymentsStore.get().owner)).toBe(true)
    const views = viewsOf(paymentsStore.get())
    expect(views.balance.status).toBe('unavailable')
    expect(views.earnings.status).toBe('unavailable')
  })

  it('never keeps them for someone else', () => {
    detaches.push(readerA())
    writerMemory.set(A, true)
    paymentsStore.fail()
    tokenNames(B)
    expect(paymentsStore.get().owner).toBeNull()
    expect(writerMemory.get(paymentsStore.get().owner)).toBeNull()
    expect(shown()).toEqual({ balance: null, earnings: null })
  })
})

describe('a press made in one session', () => {
  it('is never sent for the reader the engine still answers for', async () => {
    detaches.push(readerA())
    paymentsStore.register('control', { target, meta })
    tokenNames(B)
    paymentsStore.claim(A)
    // B presses; the control waits, and the engine for A cannot take it.
    await shellController('control').tip()
    expect(paymentsStore.get().queuedTaps.control?.pair).toBe(B)
    expect(paymentsStore.takeTap('control', A)).toBeUndefined()
    // The engine answers for B: B's press is taken once, for B.
    paymentsStore.claim(B)
    expect(paymentsStore.takeTap('control', B)?.pair).toBe(B)
    expect(paymentsStore.takeTap('control', B)).toBeUndefined()
  })

  it('made before the engine claimed the store for that pair is kept', async () => {
    detaches.push(paymentsStore.attachShell())
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('control', { target, meta })
    await shellController('control').tip()
    paymentsStore.claim(A)
    expect(paymentsStore.takeTap('control', A)?.target).toEqual(target)
  })

  it('made in A before any claim is dropped when B signs in and is claimed', async () => {
    detaches.push(paymentsStore.attachShell())
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('control', { target, meta })
    await shellController('control').tip()
    tokenNames(B)
    paymentsStore.claim(B)
    expect(paymentsStore.takeTap('control', B)).toBeUndefined()
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
  })

  it('made under token B while A was claimed is not taken when the token names A again', async () => {
    detaches.push(readerA())
    paymentsStore.register('control', { target, meta })
    tokenNames(B)
    paymentsStore.claim(A)
    await shellController('control').tip()
    tokenNames(A)
    expect(paymentsStore.takeTap('control', A)).toBeUndefined()
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
  })

  it('is refused with no session token', async () => {
    detaches.push(paymentsStore.attachShell())
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('control', { target, meta })
    await shellController('control').tip()
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
  })

  it('is not taken when the token changed with no event since', async () => {
    detaches.push(paymentsStore.attachShell())
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('control', { target, meta })
    await shellController('control').tip()
    paymentsStore.claim(A)
    writeToken(B)
    expect(paymentsStore.takeTap('control', A)).toBeUndefined()
  })
})

describe('figures for one session of a reader', () => {
  it('are hidden when the same reader signs in again elsewhere', () => {
    detaches.push(readerA())
    tokenNames(A_AGAIN)
    expect(shown()).toEqual({ balance: null, earnings: null })
    paymentsStore.claim(A_AGAIN)
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('are hidden with no token, or one that does not parse', () => {
    detaches.push(readerA())
    tokenNames(null)
    expect(shown().balance).toBeNull()
    window.localStorage.setItem(tokenKey()!, 'not a token')
    paymentsStore.readSession()
    paymentsStore.claim(A)
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBeNull()
  })
})

describe('the pair in the session token', () => {
  it('is read from this deployment’s key only', () => {
    window.localStorage.setItem('theme', 'dark')
    // Left by another deployment, and listed first.
    window.localStorage.setItem('__convexAuthJWT_aaaolddeployment', jwt(B))
    expect(tokenPair()).toBeNull()
    writeToken(A)
    expect(tokenPair()).toBe(A)
  })

  it('a token of another deployment never hides this one’s figures', () => {
    window.localStorage.setItem('__convexAuthJWT_aaaolddeployment', jwt(B))
    detaches.push(readerA())
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('is unknown with no token, an unreadable one, or a subject that is not a pair', () => {
    expect(tokenPair()).toBeNull()
    window.localStorage.setItem(tokenKey()!, 'not a token')
    expect(tokenPair()).toBeNull()
    window.localStorage.setItem(tokenKey()!, jwt('user-a'))
    expect(tokenPair()).toBeNull()
    window.localStorage.setItem(tokenKey()!, jwt('user-a|s|x'))
    expect(tokenPair()).toBeNull()
  })
})
