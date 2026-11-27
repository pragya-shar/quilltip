import { describe, expect, it } from 'vitest'
import { sentenceSpans, snapToSentences } from '@/hooks/read/sentences'

const text =
  'Two pesos to the boy who carried her bags. A peso for the bus. For thirty years she wrote one line each time.'
const at = (needle: string) => text.indexOf(needle)
const slice = (span: { start: number; end: number } | null) =>
  span ? text.slice(span.start, span.end) : null

describe('sentence spans', () => {
  it('splits a paragraph into its sentences without the spaces', () => {
    expect(sentenceSpans(text).map((s) => text.slice(s.start, s.end))).toEqual([
      'Two pesos to the boy who carried her bags.',
      'A peso for the bus.',
      'For thirty years she wrote one line each time.',
    ])
  })

  it('keeps abbreviations and initials inside the sentence', () => {
    const line = 'Dr. Ruiz met J. Reyes at St. Mary’s. Then it rained.'
    expect(sentenceSpans(line).map((s) => line.slice(s.start, s.end))).toEqual([
      'Dr. Ruiz met J. Reyes at St. Mary’s.',
      'Then it rained.',
    ])
  })

  it('keeps closing quotes with their sentence', () => {
    const line = '“It’s always first,” the man said. “I thought so.” She left.'
    const spans = sentenceSpans(line).map((s) => line.slice(s.start, s.end))
    expect(spans).toContain('“I thought so.”')
    expect(spans.at(-1)).toBe('She left.')
  })

  it('reads a question and an exclamation as ends', () => {
    const line = 'Could you set it wrong? Yes! The same wrong.'
    expect(sentenceSpans(line)).toHaveLength(3)
  })

  it('gives nothing for blank text', () => {
    expect(sentenceSpans('   ')).toEqual([])
    expect(snapToSentences('  ', 0)).toBeNull()
  })
})

describe('snapping', () => {
  it('a tap inside a sentence chooses that sentence', () => {
    expect(slice(snapToSentences(text, at('peso for')))).toBe(
      'A peso for the bus.'
    )
  })

  it('a tap just after the full stop chooses the sentence it ends', () => {
    expect(slice(snapToSentences(text, at(' A peso')))).toBe(
      'Two pesos to the boy who carried her bags.'
    )
  })

  it('a tap on the first and last character chooses that sentence', () => {
    expect(slice(snapToSentences(text, 0))).toBe(
      'Two pesos to the boy who carried her bags.'
    )
    expect(slice(snapToSentences(text, text.length))).toBe(
      'For thirty years she wrote one line each time.'
    )
  })

  it('a selection grows to the whole sentences it touches', () => {
    expect(slice(snapToSentences(text, at('boy'), at('bus') + 2))).toBe(
      'Two pesos to the boy who carried her bags. A peso for the bus.'
    )
  })

  it('a selection inside one sentence chooses that sentence', () => {
    expect(slice(snapToSentences(text, at('thirty'), at('years') + 5))).toBe(
      'For thirty years she wrote one line each time.'
    )
  })

  it('a backwards selection snaps the same way', () => {
    expect(snapToSentences(text, at('bus'), at('boy'))).toEqual(
      snapToSentences(text, at('boy'), at('bus'))
    )
  })

  it('a selection ending in the space after a sentence stops there', () => {
    expect(slice(snapToSentences(text, at('A peso'), at(' For')))).toBe(
      'A peso for the bus.'
    )
  })
})
