import { afterEach, describe, expect, it } from 'vitest'
import { writerMemory } from '../../components/pocket/writerMemory'
import { convertedMoney, money } from '../../lib/payments/money'
import { tokenOwner } from '../../lib/payments/owner'
import { shellController, viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'

/** The balance the shell's bar shows (shell/liveBalance.ts reads it so). */
const liveFigure = () => {
  const s = paymentsStore.get()
  return figuresShown(s) ? s.balance : null
}
import type {
  BalanceView,
  EarningsView,
  TipTarget,
} from '../../lib/payments/types'
import type { Id } from '../../convex/_generated/dataModel'
import { figuresShown } from '../../lib/payments/store'
import { cleanups } from '../../shell/signOut/pocket'

// The payments store holds one person's figures. Nobody else reads them:
// not after sign-out, and not after the account changes in another tab
// with no reload, before the new reader's own figures arrive.

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
  paymentsStore.setSession('user-a')
  paymentsStore.setAuth('signed-in')
  paymentsStore.claim('user-a')
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
  paymentsStore.setSession(null)
  paymentsStore.set({ engine: 'idle' })
  writerMemory.forget()
})

describe('the last reader’s figures', () => {
  it('go when another tab signs in as someone else, with the shell still mounted', () => {
    detaches.push(readerA())
    expect(shown()).toEqual({ balance: '≈ $2.54', earnings: '$9.75' })
    // Another tab signs B in: the token changes; auth reads signed in
    // throughout, and this tab's engine has not answered for B yet.
    paymentsStore.setSession('user-b')
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(paymentsStore.get().owner).toBeNull()
  })

  it('stay hidden while the engine still answers for the last reader', () => {
    detaches.push(readerA())
    paymentsStore.setSession('user-b')
    // The engine, still authenticated as A, claims and publishes again.
    paymentsStore.claim('user-a')
    paymentsStore.set({ balance: BALANCE, earnings: EARNINGS })
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(liveFigure()).toBeNull()
    // Once it answers for B, B's own figures show.
    paymentsStore.claim('user-b')
    expect(shown()).toEqual({ balance: null, earnings: null })
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('are never shown unclaimed while signed in', () => {
    detaches.push(paymentsStore.attachShell())
    paymentsStore.setAuth('signed-in')
    paymentsStore.set({ engine: 'ready', balance: BALANCE, earnings: EARNINGS })
    expect(shown()).toEqual({ balance: null, earnings: null })
    paymentsStore.claim('user-a')
    paymentsStore.set({ balance: BALANCE })
    expect(shown().balance).toBe('≈ $2.54')
  })

  it('stay for the same reader', () => {
    detaches.push(readerA())
    paymentsStore.setSession('user-a')
    paymentsStore.claim('user-a')
    expect(shown()).toEqual({ balance: '≈ $2.54', earnings: '$9.75' })
  })

  it('go when the engine publishes for someone else', () => {
    detaches.push(readerA())
    paymentsStore.setSession(null)
    paymentsStore.claim('user-b')
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(paymentsStore.get().owner).toBe('user-b')
  })

  it('go on sign-out, with whether the last person writes', async () => {
    detaches.push(readerA())
    writerMemory.set('user-a', true)
    await Promise.all(cleanups.map((cleanup) => cleanup.run()))
    expect(paymentsStore.get().auth).toBe('signed-out')
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(writerMemory.get('user-a')).toBeNull()
  })

  it('whether someone writes is remembered for that account only', () => {
    writerMemory.set('user-a', true)
    expect(writerMemory.get('user-a')).toBe(true)
    expect(writerMemory.get('user-b')).toBeNull()
  })
})

describe('an outage', () => {
  it('keeps whose figures they were, so a writer stays a writer, and shows none', () => {
    detaches.push(readerA())
    writerMemory.set('user-a', true)
    paymentsStore.fail()
    expect(paymentsStore.get().owner).toBe('user-a')
    expect(writerMemory.get(paymentsStore.get().owner)).toBe(true)
    const views = viewsOf(paymentsStore.get())
    expect(views.balance.status).toBe('unavailable')
    expect(views.earnings.status).toBe('unavailable')
  })

  it('never keeps them for someone else', () => {
    detaches.push(readerA())
    writerMemory.set('user-a', true)
    paymentsStore.fail()
    paymentsStore.setSession('user-b')
    expect(paymentsStore.get().owner).toBeNull()
    expect(writerMemory.get(paymentsStore.get().owner)).toBeNull()
    expect(shown()).toEqual({ balance: null, earnings: null })
  })
})

describe('a press made in one session', () => {
  it('is never sent for the reader the engine still answers for', async () => {
    detaches.push(readerA())
    paymentsStore.register('control', { target, meta })
    paymentsStore.setSession('user-b')
    paymentsStore.claim('user-a')
    // B presses; the control waits, and the engine for A cannot take it.
    await shellController('control').tip()
    expect(paymentsStore.get().queuedTaps.control).toBeDefined()
    expect(paymentsStore.takeTap('control')).toBeUndefined()
    // The engine answers for B: B's press is sent once.
    paymentsStore.claim('user-b')
    expect(paymentsStore.get().queuedTaps.control).toBeUndefined()
  })

  it('made before the engine claimed the store for that reader is kept', async () => {
    detaches.push(paymentsStore.attachShell())
    paymentsStore.setSession('user-a')
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('control', { target, meta })
    await shellController('control').tip()
    paymentsStore.claim('user-a')
    expect(paymentsStore.takeTap('control')?.target).toEqual(target)
  })
})

describe('the user in the session token', () => {
  const jwt = (sub: string) =>
    `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`
  const storage = (entries: Record<string, string>) => {
    const keys = Object.keys(entries)
    return {
      length: keys.length,
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => entries[k] ?? null,
    } as unknown as Storage
  }

  it('is read from the token’s subject', () => {
    expect(
      tokenOwner(
        storage({
          theme: 'dark',
          __convexAuthJWT_example: jwt('user-a|session-1'),
        })
      )
    ).toBe('user-a')
  })

  it('is unknown with no token or an unreadable one', () => {
    expect(tokenOwner(storage({}))).toBeNull()
    expect(tokenOwner(storage({ __convexAuthJWT_x: 'not a token' }))).toBeNull()
  })
})
