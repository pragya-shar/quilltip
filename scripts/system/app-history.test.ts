import { describe, expect, it } from 'vitest'
import { createAppHistory } from '@/shell/appHistory'

describe('the back control never leaves the site', () => {
  it('arrived from an external link, then Shelf, then the browser Back', () => {
    const h = createAppHistory()
    h.arrive('/tomas/ledger', 2) // the other site's page is entry 1
    expect(h.canGoBack()).toBe(false)
    h.arrive('/shelf', 3)
    expect(h.canGoBack()).toBe(true)
    h.popstate()
    h.arrive('/tomas/ledger', 3) // the browser's Back
    expect(h.canGoBack()).toBe(false)
  })

  it('after Forward, back is the link form', () => {
    const h = createAppHistory()
    h.arrive('/', 1)
    h.arrive('/shelf', 2)
    h.popstate()
    h.arrive('/', 2)
    h.popstate()
    h.arrive('/shelf', 2)
    // What is behind a page reached by Forward is not known.
    expect(h.pages()).toEqual(['/shelf'])
    expect(h.canGoBack()).toBe(false)
  })

  it('never takes a page it does not hold as one more step', () => {
    // Back to the first page, a replace, then Back again: the entry behind
    // /a is the other site.
    let h = createAppHistory()
    h.arrive('/a', 2)
    h.arrive('/b', 3)
    h.popstate()
    h.arrive('/a', 3)
    h.arrive('/c', 3)
    h.popstate()
    h.arrive('/a', 3)
    expect(h.canGoBack()).toBe(false)
    // A reload at /c, then Back twice.
    h = createAppHistory()
    h.arrive('/c', 4)
    h.popstate()
    h.arrive('/b', 4)
    h.popstate()
    h.arrive('/a', 4)
    expect(h.pages()).toEqual(['/a'])
    expect(h.canGoBack()).toBe(false)
    // A hash-only Back (no change of path), then a replace.
    h = createAppHistory()
    h.arrive('/a', 2)
    h.popstate()
    h.arrive('/b', 2)
    expect(h.canGoBack()).toBe(false)
  })

  it('a jump back of several steps never leaves the site', () => {
    const h = createAppHistory()
    h.arrive('/a', 2) // reached from another site
    h.arrive('/b', 3)
    h.arrive('/c', 4)
    h.popstate()
    h.arrive('/a', 4) // two steps back
    expect(h.pages()).toEqual(['/a'])
    expect(h.canGoBack()).toBe(false)
  })

  it('a page visited twice takes the shorter answer', () => {
    const h = createAppHistory()
    h.arrive('/a', 2)
    h.arrive('/b', 3)
    h.arrive('/a', 4)
    h.arrive('/c', 5)
    h.popstate()
    h.arrive('/a', 5) // one step or three: unknown, so the first visit
    expect(h.pages()).toEqual(['/a'])
    expect(h.canGoBack()).toBe(false)
  })

  it('counts a replace as no step', () => {
    const h = createAppHistory()
    h.arrive('/login', 2)
    h.arrive('/', 2) // router.replace after sign-in
    expect(h.canGoBack()).toBe(false)
  })

  it('a push after going back drops the forward entries', () => {
    const h = createAppHistory()
    h.arrive('/', 1)
    h.arrive('/a', 2)
    h.arrive('/b', 3)
    h.popstate()
    h.arrive('/a', 3)
    h.arrive('/c', 3) // [/, /a, /c]: the length did not grow
    expect(h.pages()).toEqual(['/', '/c'])
    expect(h.canGoBack()).toBe(true)
  })
})
