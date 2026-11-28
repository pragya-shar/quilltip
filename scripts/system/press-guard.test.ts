// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRESS_HOLD_MS,
  clickPasses,
  isPointerClick,
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
    expect(clickPasses(page, 1000, true)).toBe(false)
    expect(clickPasses(page, 1000 + PRESS_HOLD_MS - 1, true)).toBe(false)
    expect(clickPasses(page, 1000 + PRESS_HOLD_MS, true)).toBe(true)
    expect(pressesHeld()).toBe(true)
  })

  it('always lets a keyboard or assistive click through', () => {
    const page = document.createElement('button')
    at(1000)
    holdPresses()
    expect(clickPasses(page, 1001, false)).toBe(true)
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
    expect(clickPasses(inBefore, 1060, true)).toBe(false)
    expect(clickPasses(inAfter, 1060, true)).toBe(true)
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
    expect(clickPasses(page, 1650, true)).toBe(false)
    expect(clickPasses(inB, 1650, true)).toBe(false) // opened before the second
    expect(clickPasses(page, 1700, true)).toBe(true)
  })
})

describe('a pointer click', () => {
  it('is one with a pointer type or a click count', () => {
    const t = document.createElement('button')
    expect(
      isPointerClick({ target: t, detail: 0, pointerType: 'touch' }, 0)
    ).toBe(true)
    expect(isPointerClick({ target: t, detail: 1, pointerType: '' }, 0)).toBe(
      true
    )
    expect(isPointerClick({ target: t, detail: 1 }, 0)).toBe(true)
  })

  it('is one with no count when a pointer went down on it just before', () => {
    const t = document.createElement('button')
    document.body.appendChild(t)
    at(1000)
    holdPresses() // installs the pointer listener
    t.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(
      isPointerClick({ target: t, detail: 0, pointerType: '' }, 1200)
    ).toBe(true)
    expect(
      isPointerClick({ target: t, detail: 0, pointerType: '' }, 2300)
    ).toBe(false)
    t.remove()
  })

  it('is not one from the keyboard or an assistive technology', () => {
    const t = document.createElement('button')
    expect(isPointerClick({ target: t, detail: 0, pointerType: '' }, 0)).toBe(
      false
    )
    expect(isPointerClick({ target: t, detail: 0 }, 0)).toBe(false)
  })
})
