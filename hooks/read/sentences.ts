/**
 * Sentence snapping for choosing a line, on the shared sentence rule (the
 * passage identity of pull request 603, copied in `./sentenceRule` until it
 * merges). A line is a sentence: a tap inside a sentence chooses it, and a
 * selection grows to the whole sentences it touches. Offsets are UTF-16
 * indexes into one block's text (a paragraph or a list item), as the DOM
 * counts them; `gaps` are offsets where a hard break sits between words.
 *
 * Every function the reading view uses to cut sentences is in this file, so
 * moving to `@/lib/passages/sentences` is one import.
 */
import { sentenceRange, sentencesOf, type Sentence } from './sentenceRule'

export type Span = { start: number; end: number }

function sentencesIn(text: string, gaps: readonly number[]): Sentence[] {
  return sentencesOf({
    text,
    blocks: [{ start: 0, end: text.length, gaps: [...gaps] }],
  })
}

/** The sentences of a block's text, each without its surrounding space. */
export function sentenceSpans(
  text: string,
  gaps: readonly number[] = []
): Span[] {
  return sentencesIn(text, gaps).map(({ start, end }) => ({ start, end }))
}

/**
 * Snaps `[start, end)` to whole sentences of `text`. A collapsed range is a
 * caret: it chooses the sentence holding the character after it, or the
 * one before it (a tap on the right half of a full stop puts the caret
 * after it). Null when no sentence is touched.
 */
export function snapToSentences(
  text: string,
  start: number,
  end: number = start,
  gaps: readonly number[] = []
): Span | null {
  const sentences = sentencesIn(text, gaps)
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const range =
    from === to
      ? (sentenceRange(sentences, from, from) ??
        (from > 0 ? sentenceRange(sentences, from - 1, from - 1) : null))
      : sentenceRange(sentences, from, to)
  return range ? { start: range.startOffset, end: range.endOffset } : null
}
