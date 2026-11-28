import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkerSync } from '@/shell/sessionMarker'

let applied: boolean[]
beforeEach(() => {
  vi.useFakeTimers()
  applied = []
})
afterEach(() => vi.useRealTimers())

describe('the session marker under a press on the balance item', () => {
  it('follows auth at once with no press', () => {
    const marker = createMarkerSync((held) => applied.push(held))
    marker.set(false)
    expect(applied).toEqual([false])
  })

  it('waits while a pointer is down, and applies one task after it ends', () => {
    const marker = createMarkerSync((held) => applied.push(held))
    marker.pointerDown()
    marker.set(false) // auth answers under the finger
    expect(applied).toEqual([])
    marker.pointerEnd()
    // The click comes now, on the link the press began on.
    expect(applied).toEqual([])
    vi.runAllTimers()
    expect(applied).toEqual([false])
  })

  it('applies the last answer only, and nothing when none came', () => {
    const marker = createMarkerSync((held) => applied.push(held))
    marker.pointerDown()
    marker.pointerEnd()
    vi.runAllTimers()
    expect(applied).toEqual([])
    marker.pointerDown()
    marker.set(true)
    marker.set(false)
    marker.pointerEnd()
    vi.runAllTimers()
    expect(applied).toEqual([false])
  })

  it('keeps waiting when a new press starts before it applied', () => {
    const marker = createMarkerSync((held) => applied.push(held))
    marker.pointerDown()
    marker.set(false)
    marker.pointerEnd()
    marker.pointerDown()
    vi.runAllTimers()
    expect(applied).toEqual([])
    marker.pointerEnd()
    vi.runAllTimers()
    expect(applied).toEqual([false])
  })
})
