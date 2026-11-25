import { afterEach, expect, test, vi } from 'vitest'
import {
  readBookmarks,
  refreshBookmark,
  type Bookmark,
} from '../../lib/library/bookmarks'

afterEach(() => vi.unstubAllGlobals())

test('refreshBookmark updates a saved bookmark in place and leaves others alone', () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  })
  const saved = (id: string, topic: string): Bookmark => ({
    id,
    title: `Article ${id}`,
    author: 'Ada Stone',
    username: 'stone-writer',
    slug: `article-${id}`,
    topic,
    minutes: 3,
  })
  store.set(
    'quilltip.bookmarks.v1:user',
    JSON.stringify([saved('a', 'ancient'), saved('b', 'Thoughts')])
  )

  expect(refreshBookmark('user', saved('a', 'Stories'))).toBe(true)
  expect(readBookmarks('user').map((b) => [b.id, b.topic])).toEqual([
    ['a', 'Stories'],
    ['b', 'Thoughts'],
  ])
  expect(refreshBookmark('user', saved('a', 'Stories'))).toBe(false)
  expect(refreshBookmark('user', saved('c', 'Stories'))).toBe(false)
  expect(readBookmarks('user')).toHaveLength(2)
})
