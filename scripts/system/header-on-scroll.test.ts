import { describe, expect, it } from 'vitest'
import { createHeaderOnScroll } from '@/shell/headerOnScroll'

const page = { max: 4000, height: 56 }

describe('the pushed header on scroll', () => {
  it('hides on a scroll down and shows on the reader’s scroll up', () => {
    const h = createHeaderOnScroll()
    expect(h.scroll({ ...page, y: 600, at: 0 })).toBe(false)
    h.intent(100)
    expect(h.scroll({ ...page, y: 590, at: 150 })).toBe(true)
  })

  it('never shows for a scroll up with no input of the reader’s (a restore, an anchor)', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200, at: 0 })
    expect(h.scroll({ ...page, y: 800, at: 1000 })).toBe(false)
    // Input long before does not count either.
    h.intent(1000)
    expect(h.scroll({ ...page, y: 700, at: 2000 })).toBe(false)
  })

  it('shows at the top and at the end', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200, at: 0 })
    expect(h.scroll({ ...page, y: 4000, at: 10 })).toBe(true)
    h.scroll({ ...page, y: 1200, at: 20 })
    expect(h.scroll({ ...page, y: 0, at: 30 })).toBe(true)
  })

  it('ignores a small scroll down, and stays while near the top', () => {
    const h = createHeaderOnScroll()
    expect(h.scroll({ ...page, y: 5, at: 0 })).toBe(true)
    expect(h.scroll({ ...page, y: 40, at: 10 })).toBe(true) // within its height
  })

  it('does not show while a selection is being dragged', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200, at: 0 })
    h.selecting(true)
    h.intent(100)
    expect(h.scroll({ ...page, y: 1100, at: 150 })).toBe(false)
    h.selecting(false)
    h.intent(200)
    expect(h.scroll({ ...page, y: 1000, at: 250 })).toBe(true)
  })

  it('shows while focus is in it, whatever the scroll', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200, at: 0 })
    h.focus(true)
    expect(h.shown()).toBe(true)
    expect(h.scroll({ ...page, y: 1500, at: 10 })).toBe(true)
    h.focus(false)
    expect(h.shown()).toBe(false)
  })
})
