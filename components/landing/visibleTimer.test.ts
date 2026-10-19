/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { visibleTimer } from './visibleTimer'

describe('opening visible-time fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('keeps the remaining duration when the tab is hidden', () => {
    const done = vi.fn()
    visibleTimer(done, 1000)
    vi.advanceTimersByTime(400)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(599)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(done).toHaveBeenCalledOnce()
  })
  it('waits for an initially hidden tab, and cancels cleanly on unmount', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const done = vi.fn()
    const cancel = visibleTimer(done, 1000)
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    cancel()
    vi.advanceTimersByTime(1000)
    expect(done).not.toHaveBeenCalled()
  })
})
