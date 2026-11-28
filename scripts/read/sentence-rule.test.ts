import { describe, expect, it } from 'vitest'
import { canonicalText, sentencesOf } from '@/lib/passages/sentences'
import { identityVectors as vectors } from '@/lib/passages/vectors'
import { sentenceSpans } from '@/hooks/read/sentences'

// The shared sentence rule's vectors (lib/passages/vectors), through the
// reading view's own path: the rule on each document, and sentenceSpans on
// each one-block case's text, as the view cuts lines.
describe('the reading view cuts the shared vectors as the rule does', () => {
  it('is the scheme the vectors name', () => {
    expect(vectors.scheme).toBe('quilltip-passage-v1')
  })
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const canonical = canonicalText(vector.content)
      expect(canonical.text).toBe(vector.text)
      expect(
        sentencesOf(canonical).map(({ start, end, text }) => ({
          start,
          end,
          text,
        }))
      ).toEqual(vector.sentences)
    })
  }

  it('cuts a single paragraph the same through the view', () => {
    for (const vector of vectors.cases) {
      const canonical = canonicalText(vector.content)
      if (canonical.blocks.length !== 1) continue
      const block = canonical.blocks[0]!
      const text = canonical.text.slice(block.start, block.end)
      const gaps = block.gaps.map((g) => g - block.start)
      expect(
        sentenceSpans(text, gaps).map((s) => s.text),
        vector.name
      ).toEqual(vector.sentences.map((s) => s.text))
    }
  })
})
