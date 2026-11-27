// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  OPENED_COOKIE,
  READING_PLACE_KEY,
  clearReadingPlaces,
  cookieIds,
  markOpened,
  readPlaces,
  savePlace,
} from '@/hooks/read/readingPlace'

describe('reading places belong to the browser', () => {
  it('records opened and finished articles, and clears all of it', () => {
    localStorage.setItem('quilltip:reading-progress:v1', '[]')
    markOpened('a1')
    markOpened('a2')
    savePlace({
      articleId: 'a2',
      href: '/t/a2',
      title: 'A2',
      sentence: 'S.',
      percent: 1,
      updatedAt: 1,
      finished: true,
    })
    expect(cookieIds(document.cookie, OPENED_COOKIE)).toEqual(['a2', 'a1'])
    expect(cookieIds(document.cookie, 'qt_finished')).toEqual(['a2'])
    expect(readPlaces()).toHaveLength(1)

    clearReadingPlaces()
    expect(localStorage.getItem(READING_PLACE_KEY)).toBeNull()
    expect(localStorage.getItem('quilltip:reading-progress:v1')).toBeNull()
    expect(cookieIds(document.cookie, OPENED_COOKIE)).toEqual([])
    expect(cookieIds(document.cookie, 'qt_finished')).toEqual([])
  })
})

describe('sign-out clears the reading places', () => {
  it('runs through the shell sign-out registry', async () => {
    const { cleanups } = await import('@/shell/signOut/read')
    markOpened('a1')
    localStorage.setItem(READING_PLACE_KEY, '[]')
    const cleanup = cleanups.find((c) => c.name === 'reading places')!
    await cleanup.run()
    expect(localStorage.getItem(READING_PLACE_KEY)).toBeNull()
    expect(cookieIds(document.cookie, OPENED_COOKIE)).toEqual([])
  })
})
