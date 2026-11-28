// @vitest-environment happy-dom
/**
 * The payments shell, mounted for the whole visit by the root layout: it
 * drops the last reader's figures as soon as another tab changes the
 * session token, and its "Try again" loads the engine again after a
 * failure.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentsShell } from '../../components/payments/PaymentsShell'
import { viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import type { BalanceView } from '../../lib/payments/types'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const load = vi.hoisted(() => ({
  engineFails: true,
  engineLoads: 0,
}))

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/pocket' }))
vi.mock('../../components/payments/PaymentsEngine', () => {
  load.engineLoads += 1
  if (load.engineFails) throw new Error('chunk failed to load')
  return { PaymentsEngine: () => null }
})

const TOKEN_KEY = '__convexAuthJWT_example'
const jwt = (user: string) =>
  `x.${Buffer.from(JSON.stringify({ sub: `${user}|session` })).toString('base64url')}.y`

const READY = { status: 'ready' } as BalanceView

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  window.localStorage.clear()
  paymentsStore.setAuth('loading')
  paymentsStore.setSession(null)
  paymentsStore.set({ engine: 'idle' })
  load.engineFails = false
})

async function mountShell() {
  root = createRoot(document.createElement('div'))
  await act(async () => root!.render(h(PaymentsShell)))
}

describe('Try again', () => {
  it('loads the engine again when the shell is mounted', async () => {
    // The first load of the engine's code fails (first in this file, so no
    // earlier test has loaded it).
    await mountShell()
    await vi.waitFor(() => expect(paymentsStore.get().engine).toBe('failed'))
    load.engineFails = false
    vi.resetModules()
    const before = load.engineLoads
    await act(async () => paymentsStore.retry())
    await vi.waitFor(() => expect(paymentsStore.get().engine).toBe('ready'))
    expect(load.engineLoads).toBeGreaterThan(before)
  })
})

describe('the payments shell and the session token', () => {
  it('drops the last reader’s figures when another tab signs in as someone else', async () => {
    window.localStorage.setItem(TOKEN_KEY, jwt('user-a'))
    await mountShell()
    expect(paymentsStore.get().session).toBe('user-a')
    await act(async () => {
      paymentsStore.claim('user-a')
      paymentsStore.set({ balance: READY })
    })
    expect(viewsOf(paymentsStore.get()).balance).toBe(READY)

    // Another tab writes B's token; this tab hears a storage event.
    await act(async () => {
      window.localStorage.setItem(TOKEN_KEY, jwt('user-b'))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: TOKEN_KEY,
          storageArea: window.localStorage,
        })
      )
    })
    expect(paymentsStore.get().session).toBe('user-b')
    expect(paymentsStore.get().owner).toBeNull()
    expect(viewsOf(paymentsStore.get()).balance.status).toBe('loading')
  })

  it('reads the token again when the engine claims a user it did not name', async () => {
    await mountShell()
    expect(paymentsStore.get().session).toBeNull()
    // A sign-in in this tab writes the token; the engine claims that user.
    window.localStorage.setItem(TOKEN_KEY, jwt('user-a'))
    await act(async () => paymentsStore.claim('user-a'))
    expect(paymentsStore.get().session).toBe('user-a')
  })
})
