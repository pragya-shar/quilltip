/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_HEADING_TOP_OFFSET_PX, pickActiveId } from './tocActiveSection'

function mockHeading(id: string, top: number) {
  const el = document.createElement('h2')
  el.id = id
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect)
  return el
}

describe('pickActiveId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when ids is empty', () => {
    expect(pickActiveId([])).toBeNull()
  })

  it('returns null when no heading elements exist in the DOM', () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null)
    expect(pickActiveId(['a', 'b'])).toBeNull()
  })

  it('returns the first heading when all are below the offset', () => {
    const a = mockHeading('intro', 200)
    const b = mockHeading('body', 400)
    vi.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'intro') return a
      if (id === 'body') return b
      return null
    })

    expect(pickActiveId(['intro', 'body'])).toBe('intro')
  })

  it('returns the last heading at or above the offset threshold', () => {
    const a = mockHeading('intro', 40)
    const b = mockHeading('middle', 80)
    const c = mockHeading('deep', 120)
    vi.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'intro') return a
      if (id === 'middle') return b
      if (id === 'deep') return c
      return null
    })

    expect(pickActiveId(['intro', 'middle', 'deep'])).toBe('middle')
  })

  it('skips missing DOM nodes and still resolves active section', () => {
    const b = mockHeading('middle', 50)
    vi.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'missing') return null
      if (id === 'middle') return b
      return null
    })

    expect(pickActiveId(['missing', 'middle'])).toBe('middle')
  })

  it('respects a custom offset', () => {
    const a = mockHeading('intro', 150)
    vi.spyOn(document, 'getElementById').mockReturnValue(a)

    expect(pickActiveId(['intro'], 100)).toBe('intro')
    expect(pickActiveId(['intro'], 200)).toBe('intro')
  })

  it('uses the default offset constant', () => {
    const atThreshold = mockHeading('section', ACTIVE_HEADING_TOP_OFFSET_PX)
    vi.spyOn(document, 'getElementById').mockReturnValue(atThreshold)

    expect(pickActiveId(['section'])).toBe('section')
  })
})
