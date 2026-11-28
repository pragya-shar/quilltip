import { describe, expect, it } from 'vitest'
import { createAppHistory } from '@/shell/appHistory'

describe('the app history behind the header back control', () => {
  it('goes back through pages pushed in this visit', () => {
    const h = createAppHistory()
    h.arrive('/', 1)
    h.arrive('/shelf', 2)
    h.arrive('/shelf/lists', 3)
    expect(h.pages()).toEqual(['/', '/shelf', '/shelf/lists'])
    expect(h.canGoBack()).toBe(true)
  })

  it('counts a replace as no step', () => {
    const h = createAppHistory()
    h.arrive('/login', 2)
    h.arrive('/', 2) // router.replace after sign-in
    expect(h.canGoBack()).toBe(false)
  })

  it('arrived from an external link, then Shelf, then the browser Back', () => {
    const h = createAppHistory()
    h.arrive('/a', 2) // the entry behind is the other site
    h.arrive('/shelf', 3)
    h.popstate()
    h.arrive('/a', 3)
    expect(h.canGoBack()).toBe(false)
  })

  // Every shape below once called router.back() into another site.
  it('after any Back or Forward, back is the link form', () => {
    const shapes: [string, (h: ReturnType<typeof createAppHistory>) => void][] =
      [
        [
          'a jump of several steps back',
          (h) => {
            h.arrive('/a', 2)
            h.arrive('/b', 3)
            h.arrive('/c', 4)
            h.popstate()
            h.arrive('/a', 4)
          },
        ],
        [
          'Back to the first page, a replace, then Back again',
          (h) => {
            h.arrive('/a', 2)
            h.arrive('/b', 3)
            h.popstate()
            h.arrive('/a', 3)
            h.arrive('/c', 3)
            h.popstate()
            h.arrive('/a', 3)
          },
        ],
        [
          'a reload at /c, then Back twice',
          (h) => {
            h.arrive('/c', 4)
            h.popstate()
            h.arrive('/b', 4)
            h.popstate()
            h.arrive('/a', 4)
          },
        ],
        [
          'a hash-only Back, then a replace',
          (h) => {
            h.arrive('/a', 2)
            h.popstate()
            h.arrive('/b', 2)
          },
        ],
        [
          'a Back to an entry with the same path (no arrive)',
          (h) => {
            h.arrive('/a', 2)
            h.arrive('/b', 3)
            h.arrive('/a', 4)
            h.popstate()
          },
        ],
        [
          'the same, and the shell reports the same path',
          (h) => {
            h.arrive('/a', 2)
            h.arrive('/b', 3)
            h.arrive('/a', 4)
            h.popstate()
            h.arrive('/a', 4)
          },
        ],
        [
          'a reload at /a, two pushes, then a jump to the older /b',
          (h) => {
            h.arrive('/a', 3)
            h.arrive('/b', 4)
            h.arrive('/c', 5)
            h.popstate()
            h.arrive('/b', 5)
          },
        ],
        [
          'Forward',
          (h) => {
            h.arrive('/', 1)
            h.arrive('/shelf', 2)
            h.popstate()
            h.arrive('/', 2)
            h.popstate()
            h.arrive('/shelf', 2)
          },
        ],
      ]
    for (const [name, run] of shapes) {
      const h = createAppHistory()
      run(h)
      expect(h.canGoBack(), name).toBe(false)
    }
  })

  it('a push after Back counts again', () => {
    const h = createAppHistory()
    h.arrive('/', 1)
    h.arrive('/a', 2)
    h.popstate()
    h.arrive('/', 2)
    h.arrive('/c', 2) // a push that dropped the forward entry
    expect(h.canGoBack()).toBe(false)
    h.arrive('/d', 3)
    expect(h.pages()).toEqual(['/c', '/d'])
    expect(h.canGoBack()).toBe(true)
  })
})
