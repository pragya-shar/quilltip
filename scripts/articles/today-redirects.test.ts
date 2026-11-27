import { expect, test } from 'vitest'
import { redirectFor } from '../../lib/routing/redirects'
import {
  FINISHED_LIMIT,
  parseFinishedCookie,
} from '../../components/today/finished'

const at = (path: string) =>
  redirectFor(new URL(path, 'https://www.quilltip.me'))?.toString() ?? null

test.each([
  ['/articles', 'https://www.quilltip.me/'],
  ['/articles/', 'https://www.quilltip.me/'],
  ['/articles?page=3&tag=essays', 'https://www.quilltip.me/'],
  ['/articles?q=lamp%20post', 'https://www.quilltip.me/search?q=lamp%20post'],
  ['/articles?q=%20', 'https://www.quilltip.me/'],
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

test("the skip list reads the article view's cookie: ids only, at most the limit", () => {
  expect(parseFinishedCookie(undefined)).toEqual([])
  // Each id URI-encoded, comma-separated, newest first (hooks/read/readingPlace).
  expect(parseFinishedCookie('abc,def,abc,x%20y,%3Ca%3E,%E0%A4%A')).toEqual([
    'abc',
    'def',
  ])
  const many = Array.from({ length: 30 }, (_, i) => `id${i}`)
  expect(parseFinishedCookie(many.join(','))).toHaveLength(FINISHED_LIMIT)
})
