// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// The balance's own payments shell: when its code cannot load, the figures
// read unavailable (so the balance says so, with Try again) instead of
// loading for ever, and Try again loads it again.

const load = vi.hoisted(() => ({ fail: true, attempts: 0 }))
vi.mock('convex/react', () => ({ useConvex: () => ({}) }))
vi.mock('@/components/payments/PaymentsShell', () => {
  load.attempts += 1
  if (load.fail) throw new Error('chunk failed to load')
  return { PaymentsShell: () => null }
})

afterEach(() => {
  paymentsStore.setAuth('loading')
  paymentsStore.set({ engine: 'idle' })
})

describe('the balance’s payments shell', () => {
  it('says the figures are unavailable when its code cannot load, and Try again loads it again', async () => {
    const { LocalPaymentsShell, retryPayments } =
      await import('../../components/pocket/LocalPaymentsShell')
    paymentsStore.setAuth('signed-in')
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(h(LocalPaymentsShell)))
    await vi.waitFor(() => expect(paymentsStore.get().engine).toBe('failed'))
    const views = viewsOf(paymentsStore.get())
    expect(views.balance.status).toBe('unavailable')
    expect(views.earnings.status).toBe('unavailable')

    load.fail = false
    vi.resetModules()
    const before = load.attempts
    await act(async () => retryPayments())
    await vi.waitFor(() => expect(load.attempts).toBeGreaterThan(before))
    await act(async () => root.unmount())
  })
})
