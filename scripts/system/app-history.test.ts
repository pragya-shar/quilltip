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

  it('goes forward again after Back', () => {
    const h = createAppHistory()
    h.arrive('/', 1)
    h.arrive('/shelf', 2)
    h.popstate()
    h.arrive('/', 2)
    h.popstate()
    h.arrive('/shelf', 2)
    expect(h.pages()).toEqual(['/', '/shelf'])
    expect(h.canGoBack()).toBe(true)
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
