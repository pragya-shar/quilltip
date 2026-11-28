import { describe, expect, it, vi } from 'vitest'
import { leaveWhenQuiet, wouldWarn } from '@/lib/auth/leaveWhenQuiet'

/** A page with an unload guard that warns while `busy()` is true. */
function pageWithGuard(busy: () => boolean) {
  const target = new EventTarget()
  target.addEventListener('beforeunload', (event) => {
    if (busy()) event.preventDefault()
  })
  return target
}

describe('leaving the sign-in page', () => {
  it('waits while a guard on the page would warn, then goes', async () => {
    let busy = true
    setTimeout(() => (busy = false), 120)
    const go = vi.fn()
    const started = Date.now()
    await leaveWhenQuiet(
      go,
      2_000,
      pageWithGuard(() => busy)
    )
    expect(go).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('goes at the limit if a guard never stops warning', async () => {
    const go = vi.fn()
    const started = Date.now()
    await leaveWhenQuiet(
      go,
      150,
      pageWithGuard(() => true)
    )
    expect(go).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('goes at once when nothing would warn, or with no page', async () => {
    const go = vi.fn()
    await leaveWhenQuiet(
      go,
      2_000,
      pageWithGuard(() => false)
    )
    await leaveWhenQuiet(go, 2_000, null)
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('asks without silencing anything: the guard still warns on a real unload', () => {
    const target = pageWithGuard(() => true)
    expect(wouldWarn(target)).toBe(true)
    expect(wouldWarn(target)).toBe(true)
  })
})
