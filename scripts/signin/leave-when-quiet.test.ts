import { describe, expect, it, vi } from 'vitest'
import { leaveWhenQuiet } from '@/lib/auth/leaveWhenQuiet'

const client = (busy: () => boolean) => ({
  connectionState: () => ({ hasInflightRequests: busy() }),
})

describe('leaving the sign-in page', () => {
  it('goes once the backend client has nothing in flight', async () => {
    let busy = true
    const go = vi.fn()
    setTimeout(() => (busy = false), 120)
    const started = Date.now()
    await leaveWhenQuiet(
      client(() => busy),
      go
    )
    expect(go).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('goes at the limit even if a request never ends', async () => {
    const go = vi.fn()
    const started = Date.now()
    await leaveWhenQuiet(
      client(() => true),
      go,
      150
    )
    expect(go).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('goes at once with no client or nothing in flight', async () => {
    const go = vi.fn()
    await leaveWhenQuiet(null, go)
    await leaveWhenQuiet(
      client(() => false),
      go
    )
    expect(go).toHaveBeenCalledTimes(2)
  })
})
