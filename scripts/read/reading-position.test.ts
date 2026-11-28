import { describe, expect, it } from 'vitest'
import {
  positionIn,
  scrollDeltaFor,
  shouldRestore,
} from '@/hooks/read/readingPosition'

describe('reading position', () => {
  it('measures how much of the body has passed the screen', () => {
    expect(positionIn('a', { top: -500, height: 2000 }, 800)).toEqual({
      id: 'a',
      ratio: 0.65,
      offset: 0.25,
    })
    expect(positionIn('a', { top: 0, height: 0 }, 800)).toBeNull()
  })

  it('returns the body to the same place', () => {
    const saved = positionIn('a', { top: -500, height: 2000 }, 800)!
    // Opened again at the top: the body starts 120 px down.
    expect(scrollDeltaFor(saved, { top: 120, height: 2000 }, 800)).toBe(620)
  })

  it('never jumps past what was read while the body was below the top', () => {
    const saved = positionIn('a', { top: 200, height: 2000 }, 800)!
    expect(saved.offset).toBe(0)
    expect(scrollDeltaFor(saved, { top: 200, height: 2000 }, 800)).toBe(0)
  })

  it('restores on every open and on Back, not over a named place or line', () => {
    expect(shouldRestore({ hash: '', navigationType: 'navigate' })).toBe(true)
    expect(shouldRestore({ hash: '', navigationType: 'reload' })).toBe(true)
    // Back from another site loads the article again.
    expect(shouldRestore({ hash: '', navigationType: 'back_forward' })).toBe(
      true
    )
    expect(shouldRestore({ hash: '#start', navigationType: 'navigate' })).toBe(
      false
    )
    expect(
      shouldRestore({ hash: '#start', navigationType: 'back_forward' })
    ).toBe(false)
    expect(
      shouldRestore({ hash: '', navigationType: 'navigate', aimed: true })
    ).toBe(false)
  })
})
