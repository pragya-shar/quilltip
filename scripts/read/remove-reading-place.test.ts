// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FINISHED_COOKIE,
  OPENED_COOKIE,
  clearReadingPlaces,
  cookieIds,
  finishedIds,
  markOpened,
  readPlaces,
  removePlace,
  restorePlace,
  savePlace,
} from '@/hooks/read/readingPlace'

const save = (articleId: string, updatedAt: number, finished = false) =>
  savePlace({
    articleId,
    href: `/t/${articleId}`,
    title: articleId,
    sentence: 'S.',
    percent: finished ? 1 : 0.4,
    updatedAt,
    finished,
  })
const ids = () => readPlaces().map((p) => p.articleId)

describe('removing a place, with Undo', () => {
  beforeEach(() => clearReadingPlaces())

  it('forgets the place but not that the article was opened or finished', () => {
    markOpened('a')
    markOpened('b')
    save('a', 1, true)
    save('b', 2)
    expect(removePlace('a')).toMatchObject({ index: 1 })
    expect(ids()).toEqual(['b'])
    expect(cookieIds(document.cookie, OPENED_COOKIE)).toEqual(['b', 'a'])
    expect(cookieIds(document.cookie, FINISHED_COOKIE)).toEqual(['a'])
    // A later save keeps the removed article finished.
    save('b', 3)
    expect(cookieIds(document.cookie, FINISHED_COOKIE)).toEqual(['a'])
  })

  it('puts the place back where it stood', () => {
    save('a', 1)
    save('b', 2)
    save('c', 3)
    const removed = removePlace('b')!
    expect(ids()).toEqual(['c', 'a'])
    restorePlace(removed)
    expect(ids()).toEqual(['c', 'b', 'a'])
    expect(readPlaces()[1]).toEqual(removed.place)
  })

  it('lets a newer place win over Undo', () => {
    save('a', 1)
    const removed = removePlace('a')!
    save('a', 5)
    restorePlace(removed)
    expect(readPlaces()).toHaveLength(1)
    expect(readPlaces()[0]!.updatedAt).toBe(5)
  })

  it('returns null for an article with no place', () => {
    expect(removePlace('none')).toBeNull()
  })

  it('merges stored finished ids with the cookie, newest first, at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => `x${i}`)
    expect(finishedIds([], many)).toHaveLength(20)
    expect(
      finishedIds(
        [
          {
            articleId: 'a',
            href: '/a',
            title: 'A',
            sentence: '',
            percent: 1,
            updatedAt: 1,
            finished: true,
          },
          {
            articleId: 'b',
            href: '/b',
            title: 'B',
            sentence: '',
            percent: 0,
            updatedAt: 1,
            finished: false,
          },
        ],
        ['b', 'c', 'a']
      )
    ).toEqual(['a', 'c'])
  })
})
