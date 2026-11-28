import { afterEach, describe, expect, it } from 'vitest'
import { writerMemory } from '../../components/pocket/writerMemory'
import { convertedMoney, money } from '../../lib/payments/money'
import { tokenOwner } from '../../lib/payments/owner'
import { viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import type { BalanceView, EarningsView } from '../../lib/payments/types'
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

/** Reader A's figures, published by an engine under one shell. */
function readerA() {
  const detach = paymentsStore.attachShell('user-a')
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

let detaches: (() => void)[] = []
afterEach(() => {
  for (const detach of detaches) detach()
  detaches = []
  paymentsStore.setAuth('loading')
  writerMemory.forget()
})

describe('the last reader’s figures', () => {
  it('go when the account changes with no reload, before the new engine answers', () => {
    // A opens the balance sheet, then closes it.
    readerA()()
    // Another tab signs B in; B opens the sheet here. Auth reads signed in
    // throughout, so nothing else would clear the store.
    detaches.push(paymentsStore.attachShell('user-b'))
    paymentsStore.setAuth('signed-in')
    expect(shown()).toEqual({ balance: null, earnings: null })
    expect(paymentsStore.get().owner).toBeNull()
  })

  it('stay for the same reader reopening the sheet', () => {
    readerA()()
    detaches.push(paymentsStore.attachShell('user-a'))
    expect(shown()).toEqual({ balance: '≈ $2.54', earnings: '$9.75' })
  })

  it('go when the engine publishes for someone else', () => {
    detaches.push(readerA())
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
