import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRESS_WINDOW_MS,
  createPressWindow,
  holdPresses,
  pressesHeld,
  releasePresses,
} from '@/system/pressGuard'

afterEach(() => {
  vi.restoreAllMocks()
  releasePresses()
})

describe('whether a modal close holds presses', () => {
  it('holds after a pointer press inside it, whoever closes it', () => {
    const w = createPressWindow()
    w.press(1000)
    // The control's own handler at once, a result 300 ms later, the stack.
    expect(w.holds(1000)).toBe(true)
    expect(w.holds(1300)).toBe(true)
    expect(w.holds(1000 + PRESS_WINDOW_MS)).toBe(true)
  })

  it('never holds with no recent press inside it', () => {
    const w = createPressWindow()
    expect(w.holds(1000)).toBe(false) // a timer, a change of page
    w.press(1000)
    expect(w.holds(1000 + PRESS_WINDOW_MS + 1)).toBe(false)
  })

  it('never holds after a keyboard close', () => {
    const w = createPressWindow()
    w.press(1000)
    w.key(1200) // Escape, or Enter on a button
    expect(w.holds(1200)).toBe(false)
    // A press after the key counts again.
    w.press(1300)
    expect(w.holds(1350)).toBe(true)
  })
})

describe('the hold', () => {
  it('holds pointer presses for a moment, and a release ends it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    holdPresses(400)
    expect(pressesHeld()).toBe(true)
    releasePresses()
    expect(pressesHeld()).toBe(false)
    holdPresses(400)
    vi.spyOn(performance, 'now').mockReturnValue(1401)
    expect(pressesHeld()).toBe(false)
  })
})
