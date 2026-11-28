import { describe, expect, it } from 'vitest'
import { createHeaderOnScroll } from '@/shell/headerOnScroll'

const page = { max: 4000, height: 56 }

describe('the pushed header on scroll', () => {
  it('hides on a scroll down and shows on the reader’s scroll up', () => {
    const h = createHeaderOnScroll()
    expect(h.scroll({ ...page, y: 600 })).toBe(false)
    h.input(-1)
    expect(h.scroll({ ...page, y: 590 })).toBe(true)
  })

  it('shows however late the scroll event comes, while the gesture lasts', () => {
    // A busy page: the wheel, then its scroll event long after.
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    h.input(-1)
    // No time in the model: only whether the reader's gesture is on.
    expect(h.scroll({ ...page, y: 1100 })).toBe(true)
  })

  it('a late end of the earlier scroll does not end a gesture whose scroll has not come', () => {
    const h = createHeaderOnScroll()
    h.input(1)
    expect(h.scroll({ ...page, y: 900 })).toBe(false)
    // The reader wheels up; the down scroll's `scrollend` comes after.
    h.input(-1)
    expect(h.settled()).toBe(false)
    expect(h.gesturing()).toBe(true)
    expect(h.scroll({ ...page, y: 780 })).toBe(true)
    // Its own scroll has come: now its end ends it.
    expect(h.settled()).toBe(true)
    expect(h.gesturing()).toBe(false)
  })

  it('a late scroll the earlier way is not the scroll the gesture waits for', () => {
    const h = createHeaderOnScroll()
    h.input(1)
    h.scroll({ ...page, y: 900 })
    h.input(-1)
    // The down scroll still arriving after the reader's wheel up.
    h.scroll({ ...page, y: 950 })
    expect(h.settled()).toBe(false)
    expect(h.scroll({ ...page, y: 830 })).toBe(true)
  })

  it('a touch waits for a scroll either way', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    h.input(0)
    expect(h.settled()).toBe(false)
    h.scroll({ ...page, y: 1300 })
    expect(h.settled()).toBe(true)
  })

  it('never shows for a scroll up with no gesture of the reader’s (a restore, an anchor)', () => {
    const h = createHeaderOnScroll()
    h.scroll({ ...page, y: 1200 })
    expect(h.scroll({ ...page, y: 800 })).toBe(false)
    // A gesture that a press ended does not count either.
    h.input(-1)
    h.interrupt()
    expect(h.scroll({ ...page, y: 700 })).toBe(false)
    // Nor one that ended with its scroll.
    h.input(-1)
    h.scroll({ ...page, y: 650 })
    h.settled()
    expect(h.scroll({ ...page, y: 640 })).toBe(true)
    h.scroll({ ...page, y: 1000 })
    expect(h.scroll({ ...page, y: 600 })).toBe(false)
  })

  it('starts from where the page is', () => {
    // A restored place: the first scroll is measured from there.
    const h = createHeaderOnScroll(1200)
    expect(h.scroll({ ...page, y: 1205 })).toBe(true)
    expect(h.scroll({ ...page, y: 1300 })).toBe(false)
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
    h.input(-1)
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
