import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  holdPresses,
  notePressClose,
  pressesHeld,
  releasePresses,
  takePressClose,
} from '@/system/pressGuard'

afterEach(() => {
  vi.restoreAllMocks()
  releasePresses()
  takePressClose()
})

const at = (ms: number) => vi.spyOn(performance, 'now').mockReturnValue(ms)

describe('the press guard', () => {
  it('holds after a press-close only, taken once', () => {
    at(1000)
    // A close by a script or a timer: nothing noted, nothing held.
    expect(takePressClose()).toBe(false)
    notePressClose()
    at(1050)
    expect(takePressClose()).toBe(true)
    // The next close (a script's) is not a press-close.
    expect(takePressClose()).toBe(false)
  })

  it('forgets a press-close whose modal never closed', () => {
    at(1000)
    notePressClose()
    at(2500)
    expect(takePressClose()).toBe(false)
  })

  it('holds pointer presses for a moment', () => {
    at(1000)
    holdPresses(400)
    expect(pressesHeld()).toBe(true)
    at(1401)
    expect(pressesHeld()).toBe(false)
  })
})
