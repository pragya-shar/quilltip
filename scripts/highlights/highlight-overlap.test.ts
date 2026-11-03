import { expect, test } from 'vitest'
import { buildHighlightSegments } from '../../lib/highlights/highlight-overlap'

test('overlapping passage starts retain their identities under the primary mark', () => {
  const segments = buildHighlightSegments([
    { id: 'outer', startOffset: 0, endOffset: 20, createdAt: 1 },
    { id: 'inner', startOffset: 0, endOffset: 10, createdAt: 2 },
    { id: 'newer', startOffset: 0, endOffset: 10, createdAt: 3 },
    { id: 'later', startOffset: 10, endOffset: 20, createdAt: 4 },
  ])

  expect(segments.map((segment) => segment.primary.id)).toEqual([
    'newer',
    'later',
  ])
  expect(segments.map((segment) => segment.passageStartIds)).toEqual([
    ['outer', 'inner', 'newer'],
    ['later'],
  ])
})
