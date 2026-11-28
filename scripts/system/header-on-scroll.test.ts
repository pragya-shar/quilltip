import { describe, expect, it } from 'vitest'
import { createHeaderOnScroll } from '@/shell/headerOnScroll'

const page = { max: 4000, height: 56 }

describe('the pushed header on scroll', () => {
  it('hides on a scroll down and shows on the reader’s scroll up', () => {
    const h = createHeaderOnScroll()
    expect(h.scroll({ ...page, y: 600 })).toBe(false)
    h.gesture(true)
    expect(h.scroll({ ...page, y: 590 })).toBe(true)
  })

  it('shows however late the scroll event comes, while the gesture lasts', () => {
    // A busy page: the wheel, then its scroll event long after.
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    h.gesture(true)
    // No time in the model: only whether the reader's gesture is on.
    expect(h.scroll({ ...page, y: 1100 })).toBe(true)
  })

  it('never shows for a scroll up with no gesture of the reader’s (a restore, an anchor)', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    expect(h.scroll({ ...page, y: 800 })).toBe(false)
    // A gesture that ended does not count either.
    h.gesture(true)
    h.gesture(false)
    expect(h.scroll({ ...page, y: 700 })).toBe(false)
  })

  it('shows at the top and at the end', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    expect(h.scroll({ ...page, y: 4000 })).toBe(true)
    h.scroll({ ...page, y: 1200 })
    expect(h.scroll({ ...page, y: 0 })).toBe(true)
  })

  it('ignores a small scroll down, and stays while near the top', () => {
    const h = createHeaderOnScroll()
    expect(h.scroll({ ...page, y: 5 })).toBe(true)
    expect(h.scroll({ ...page, y: 40 })).toBe(true) // within its height
  })

  it('does not show while a selection is being dragged', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    h.selecting(true)
    h.gesture(true)
    expect(h.scroll({ ...page, y: 1100 })).toBe(false)
    h.selecting(false)
    expect(h.scroll({ ...page, y: 1000 })).toBe(true)
  })

  it('shows while focus is in it, whatever the scroll', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    h.focus(true)
    expect(h.shown()).toBe(true)
    expect(h.scroll({ ...page, y: 1500 })).toBe(true)
    h.focus(false)
    expect(h.shown()).toBe(false)
  })
})
