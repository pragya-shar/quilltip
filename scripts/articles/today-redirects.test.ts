import { expect, test } from 'vitest'
import { redirectFor } from '../../lib/routing/redirects'
import {
  COOKIE_ID_LIMIT,
  parseSkipCookie,
  skipList,
} from '../../components/today/finished'

const at = (path: string) =>
  redirectFor(new URL(path, 'https://www.quilltip.me'))?.toString() ?? null

// Until /search exists, the reading room goes to Today with any query.
test.each([
  ['/articles', 'https://www.quilltip.me/'],
  ['/articles/', 'https://www.quilltip.me/'],
  ['/articles?page=3&tag=essays', 'https://www.quilltip.me/'],
  ['/articles?search=lamp%20post', 'https://www.quilltip.me/'],
  ['/articles?q=lamp%20post', 'https://www.quilltip.me/'],
  ['/demo/write', 'https://www.quilltip.me/write'],
  ['/demo/write/', 'https://www.quilltip.me/write'],
])('%s moves to %s', (path, expected) => {
  expect(at(path)).toBe(expected)
})

test.each(['/', '/articlesx', '/demo', '/demo/read', '/writer/articles'])(
  '%s does not move',
  (path) => {
    expect(at(path)).toBeNull()
  }
)

const A = 'k57a1b2c3d4e5f6g7h8j9m0n1p2q3r4s'
const B = 'k97x8w7v6t5s4r3q2p1n0m9j8h7g6f5e'

test('a skip cookie holds Convex ids only, at most 20; anything else is ignored', () => {
  expect(parseSkipCookie(undefined)).toEqual([])
  // Each id URI-encoded, comma-separated, newest first (hooks/read/readingPlace).
  expect(
    parseSkipCookie(
      `${A},${encodeURIComponent(B)},${A},abc,ABCDEFGHIJKLMNOPQRS,x%20y,%3Ca%3E,%E0%A4%A`
    )
  ).toEqual([A, B])
  const many = Array.from({ length: 30 }, (_, i) => `${A.slice(0, 20)}${i}`)
  expect(parseSkipCookie(many.join(','))).toHaveLength(COOKIE_ID_LIMIT)
})

test('the skip list is finished then opened ids, without repeats, at most 40', () => {
  expect(skipList(A, `${B},${A}`)).toEqual([A, B])
  expect(skipList(undefined, undefined)).toEqual([])
  const ids = (p: string) =>
    Array.from({ length: 25 }, (_, i) => `${p}${String(i).padStart(18, '0')}`)
  expect(skipList(ids('fin').join(','), ids('opn').join(','))).toHaveLength(40)
})
