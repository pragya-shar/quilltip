// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRESS_HOLD_MS,
  clickPasses,
  holdPresses,
  noteModalOpened,
  pressesHeld,
  resetPresses,
} from '@/system/pressGuard'

afterEach(() => {
  vi.restoreAllMocks()
  resetPresses()
})

const at = (ms: number) => vi.spyOn(performance, 'now').mockReturnValue(ms)

describe('the press hold', () => {
  it('holds every pointer click on the page for 400 ms after a close', () => {
    const page = document.createElement('button')
    at(1000)
    holdPresses()
    expect(clickPasses(page, 1000, 1)).toBe(false)
    expect(clickPasses(page, 1000 + PRESS_HOLD_MS - 1, 1)).toBe(false)
    expect(clickPasses(page, 1000 + PRESS_HOLD_MS, 1)).toBe(true)
    expect(pressesHeld()).toBe(true)
  })

  it('always lets a keyboard or assistive click through', () => {
    const page = document.createElement('button')
    at(1000)
    holdPresses()
    expect(clickPasses(page, 1001, 0)).toBe(true)
  })

  it('lets through only a modal opened after the close', () => {
    const before = document.createElement('dialog')
    const after = document.createElement('dialog')
    const inBefore = before.appendChild(document.createElement('button'))
    const inAfter = after.appendChild(document.createElement('button'))
    at(900)
    noteModalOpened(before) // the lower sheet, open under the one that closed
    at(1000)
    holdPresses()
    at(1050)
    noteModalOpened(after)
    expect(clickPasses(inBefore, 1060, 1)).toBe(false)
    expect(clickPasses(inAfter, 1060, 1)).toBe(true)
  })

  it('extends with each close, and the exception moves with it', () => {
    const page = document.createElement('button')
    const b = document.createElement('dialog')
    const inB = b.appendChild(document.createElement('button'))
    at(1000)
    holdPresses()
    at(1100)
    noteModalOpened(b)
    at(1300)
    holdPresses() // a second close, 300 ms later
    expect(clickPasses(page, 1650, 1)).toBe(false)
    expect(clickPasses(inB, 1650, 1)).toBe(false) // opened before the second
    expect(clickPasses(page, 1700, 1)).toBe(true)
  })
})
