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
import { A, B, storageEvent, writeToken } from './sessionToken'
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
  /** A's figures, published by an engine claimed for A. */
  async function readerA() {
    writeToken(A)
    await mountShell()
    expect(paymentsStore.get().session).toBe(A)
    await act(async () => {
      paymentsStore.claim(A)
      paymentsStore.set({ balance: READY })
    })
    expect(viewsOf(paymentsStore.get()).balance).toBe(READY)
  }
  const hidden = () => {
    expect(paymentsStore.get().session).toBe(B)
    expect(paymentsStore.get().owner).toBeNull()
    expect(viewsOf(paymentsStore.get()).balance.status).toBe('loading')
  }

  it('drops the last reader’s figures when another tab signs in as someone else', async () => {
    await readerA()
    // Another tab writes B's token; this tab hears a storage event.
    await act(async () => {
      writeToken(B)
      storageEvent()
    })
    hidden()
  })

  it('reads the token again when another tab clears all of storage (a null key)', async () => {
    await readerA()
    await act(async () => {
      window.localStorage.clear()
      storageEvent(null)
    })
    expect(paymentsStore.get().session).toBeNull()
    expect(paymentsStore.get().owner).toBeNull()
    expect(viewsOf(paymentsStore.get()).balance.status).toBe('loading')
  })

  it('ignores a storage event for another deployment’s key', async () => {
    await readerA()
    await act(async () => storageEvent('__convexAuthJWT_aaaolddeployment'))
    expect(viewsOf(paymentsStore.get()).balance).toBe(READY)
  })

  it('reads the token again on focus, with no storage event', async () => {
    await readerA()
    writeToken(B)
    await act(async () => window.dispatchEvent(new Event('focus')))
    hidden()
  })

  it('reads the token again when the page becomes visible', async () => {
    await readerA()
    writeToken(B)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    hidden()
  })

  it('reads the token again when the page is shown from the back-forward cache', async () => {
    await readerA()
    writeToken(B)
    await act(async () => window.dispatchEvent(new Event('pageshow')))
    hidden()
  })

  it('reads the token again when the engine claims a pair it did not name', async () => {
    await mountShell()
    expect(paymentsStore.get().session).toBeNull()
    // A sign-in in this tab writes the token; the engine claims that pair.
    writeToken(A)
    await act(async () => paymentsStore.claim(A))
    expect(paymentsStore.get().session).toBe(A)
  })

  it('stops reading once unmounted', async () => {
    await readerA()
    await act(async () => root?.unmount())
    root = null
    writeToken(B)
    window.dispatchEvent(new Event('focus'))
    expect(paymentsStore.get().session).toBe(A)
  })
})
