import { describe, expect, it } from 'vitest'
import {
  buildHighlightSegments,
  countRangesOverlapping,
  pickPrimaryRange,
} from './highlight-overlap'

describe('highlight-overlap', () => {
  const word = {
    id: 'word',
    startOffset: 10,
    endOffset: 15,
    createdAt: 1,
  }
  const sentence = {
    id: 'sentence',
    startOffset: 0,
    endOffset: 50,
    createdAt: 2,
  }

  it('counts overlapping ranges on shared text', () => {
    expect(countRangesOverlapping([word, sentence], 10, 15)).toBe(2)
    expect(countRangesOverlapping([word, sentence], 0, 10)).toBe(1)
  })

  it('picks the shortest span as primary', () => {
    expect(pickPrimaryRange([sentence, word]).id).toBe('word')
  })

  it('builds segments with correct overlap counts', () => {
    const segments = buildHighlightSegments([word, sentence])
    const overlap = segments.find(
      (s) => s.startOffset === 10 && s.endOffset === 15
    )
    expect(overlap?.overlapCount).toBe(2)
    expect(overlap?.primary.id).toBe('word')

    const sentenceOnly = segments.find(
      (s) => s.startOffset === 0 && s.endOffset === 10
    )
    expect(sentenceOnly?.overlapCount).toBe(1)
    expect(sentenceOnly?.primary.id).toBe('sentence')
  })
})
