import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalText, sentencesOf } from '@/hooks/read/sentenceRule'
import { sentenceSpans } from '@/hooks/read/sentences'

// The shared sentence rule's own vectors (pull request 603 at 29206235,
// lib/passages/vectors/identity-v1.json, copied beside this test). Delete
// both this copy and hooks/read/sentenceRule.ts when 603 merges.
type Vector = {
  name: string
  content: unknown
  text: string
  sentences: { start: number; end: number; text: string }[]
}
const vectors = JSON.parse(
  readFileSync(path.join(__dirname, 'sentence-vectors-v1.json'), 'utf8')
) as { scheme: string; cases: Vector[] }

describe('the copied sentence rule matches the shared vectors', () => {
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
