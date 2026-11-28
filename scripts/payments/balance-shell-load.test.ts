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
import {
  DeferredPaymentsShell,
  FIRST_RETRY_MS,
  MAX_RETRY_MS,
  loadWithBackoff,
  shellImport,
} from '../../shell/DeferredPaymentsShell'
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

describe('its retries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Attempts that always fail, with the time of each, from 0. */
  function failing() {
    const at: number[] = []
    const start = Date.now()
    const attempt = () => {
      at.push(Date.now() - start)
      return Promise.reject(new Error('chunk failed to load'))
    }
    return { at, attempt }
  }

  it('wait 5 s, then twice as long each time, up to 5 minutes', async () => {
    vi.useFakeTimers()
    const { at, attempt } = failing()
    const fails = vi.fn()
    const loading = loadWithBackoff(attempt, () => {}, fails)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    loading.stop()
    const waits = at.slice(1).map((t, i) => t - at[i]!)
    expect(waits.slice(0, 8)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000,
    ])
    expect(Math.max(...waits)).toBe(MAX_RETRY_MS)
    expect(fails).toHaveBeenCalledTimes(at.length)
  })

  it('stop when the loader unmounts, with nothing run after', async () => {
    vi.useFakeTimers()
    const { at, attempt } = failing()
    const loading = loadWithBackoff(
      attempt,
      () => {},
      () => {}
    )
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
    expect(at).toHaveLength(2)
    loading.stop()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(at).toHaveLength(2)
    loading.now()
    expect(at).toHaveLength(2)
  })

  it('try again at once on Try again, and start the delays over', async () => {
    vi.useFakeTimers()
    const { at, attempt } = failing()
    const loading = loadWithBackoff(
      attempt,
      () => {},
      () => {}
    )
    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000)
    expect(at).toHaveLength(4)
    loading.now()
    await vi.advanceTimersByTimeAsync(0)
    expect(at).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
    expect(at).toHaveLength(6)
    loading.stop()
  })

  it('stop once loaded', async () => {
    vi.useFakeTimers()
    let calls = 0
    const loaded = vi.fn()
    const loading = loadWithBackoff(
      () =>
        ++calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve(1),
      loaded,
      () => {}
    )
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(calls).toBe(2)
    expect(loaded).toHaveBeenCalledWith(1)
    loading.stop()
  })
})

describe('the loader component', () => {
  it('stops trying once unmounted', async () => {
    vi.useFakeTimers()
    const real = shellImport.load
    let attempts = 0
    shellImport.load = () => {
      attempts += 1
      return Promise.reject(new Error('chunk failed to load'))
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(h(DeferredPaymentsShell)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
    })
    // Tried now and after 5 s, and still failing.
    expect(attempts).toBe(2)
    expect(paymentsStore.get().engine).toBe('failed')
    await act(async () => root.unmount())
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(attempts).toBe(2)
    // Try again after unmount does nothing either.
    paymentsStore.retry()
    expect(attempts).toBe(2)
    shellImport.load = real
    vi.useRealTimers()
  })
})
