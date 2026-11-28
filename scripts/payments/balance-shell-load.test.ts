// @vitest-environment happy-dom
/**
 * The root layout's loader for the payments shell
 * (`shell/DeferredPaymentsShell`): when the shell's code cannot load, the
 * figures read unavailable (the balance says so, with Try again) instead
 * of loading for ever, and Try again loads it again.
 */
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import { DeferredPaymentsShell } from '../../shell/DeferredPaymentsShell'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const load = vi.hoisted(() => ({ fail: true, attempts: 0 }))
vi.mock('@/components/payments/PaymentsShell', () => {
  load.attempts += 1
  if (load.fail) throw new Error('chunk failed to load')
  return { PaymentsShell: () => null }
})

afterEach(() => {
  paymentsStore.setAuth('loading')
  paymentsStore.set({ engine: 'idle' })
})

describe('the payments shell’s loader', () => {
  it('says the figures are unavailable when the shell cannot load, and Try again loads it again', async () => {
    paymentsStore.setAuth('signed-in')
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(h(DeferredPaymentsShell)))
    await vi.waitFor(() => expect(paymentsStore.get().engine).toBe('failed'))
    const views = viewsOf(paymentsStore.get())
    expect(views.balance.status).toBe('unavailable')
    expect(views.earnings.status).toBe('unavailable')

    load.fail = false
    vi.resetModules()
    const before = load.attempts
    await act(async () => paymentsStore.retry())
    await vi.waitFor(() => expect(load.attempts).toBeGreaterThan(before))
    await act(async () => root.unmount())
  })
})
