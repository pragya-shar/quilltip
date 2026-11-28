// @vitest-environment happy-dom
/**
 * The bar's balance item on the live source (shell/liveBalance.ts), under
 * the binding rule: its held link states a figure only while the session
 * token names the pair the figures were claimed for, and its sign-in link
 * is the one the session marker shows once the token is gone (Convex Auth
 * then reads signed out: it follows a storage event for its token key).
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertedMoney, money } from '../../lib/payments/money'
import { paymentsStore } from '../../lib/payments/store'
import type { BalanceView } from '../../lib/payments/types'
import { BalanceSourceContext } from '../../shell/balance'
import { BalanceItem } from '../../shell/BalanceItem'
import { useLiveBalance } from '../../shell/liveBalance'
import { SESSION_ATTR } from '../../shell/prePaint'
import { A, B, tokenNames } from './sessionToken'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false }))
vi.mock('convex/react', () => ({ useConvexAuth: () => ({ ...auth }) }))

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

let root: Root | null = null
let detach: (() => void) | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  detach?.()
  detach = null
  auth.isAuthenticated = true
  window.localStorage.clear()
  paymentsStore.setAuth('loading')
  paymentsStore.setSession(null)
  document.documentElement.removeAttribute(SESSION_ATTR)
  document.body.innerHTML = ''
})

const held = () =>
  document.querySelector<HTMLAnchorElement>('a[data-when="held"]')!
const marker = () => document.documentElement.getAttribute(SESSION_ATTR)

async function itemFor(pair: string) {
  detach = paymentsStore.attachShell()
  tokenNames(pair)
  paymentsStore.setAuth('signed-in')
  paymentsStore.claim(pair)
  paymentsStore.set({ balance: BALANCE })
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () =>
    root!.render(
      h(
        BalanceSourceContext.Provider,
        { value: useLiveBalance },
        h(BalanceItem, { className: 'qt-nav__item' })
      )
    )
  )
}

describe('the bar’s balance item under the session binding', () => {
  it('states the figure for the pair in the token', async () => {
    await itemFor(A)
    expect(held().getAttribute('aria-label')).toBe(
      'Balance, about 2 dollars 54. Open balance'
    )
    expect(held().textContent).toContain('2.54')
    expect(marker()).toBe('held')
  })

  it('hides the held link’s figure when the token names someone else', async () => {
    await itemFor(A)
    await act(async () => {
      tokenNames(B)
      paymentsStore.claim(A)
      paymentsStore.set({ balance: BALANCE })
    })
    expect(held().getAttribute('aria-label')).toBe('Balance. Open balance')
    expect(held().textContent).toBe('Balance')
    // Still signed in: the held link stays the one shown, never a zero.
    expect(marker()).toBe('held')
  })

  it('shows the sign-in link once the token is gone', async () => {
    await itemFor(A)
    await act(async () => {
      tokenNames(null)
      // Convex Auth follows the storage event for its key: signed out.
      auth.isAuthenticated = false
      paymentsStore.setAuth('signed-out')
      root!.render(
        h(
          BalanceSourceContext.Provider,
          { value: useLiveBalance },
          h(BalanceItem, { className: 'qt-nav__item' })
        )
      )
    })
    expect(marker()).toBeNull()
    expect(held().textContent).toBe('Balance')
    expect(
      document.querySelector('a[data-when="signed-out"]')?.textContent
    ).toBe('Sign in')
  })
})
