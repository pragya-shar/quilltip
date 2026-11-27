/**
 * Sentence snapping for choosing a line. A line is a sentence: a tap inside
 * a sentence chooses that sentence, and a selection grows to the whole
 * sentences it touches. Offsets are UTF-16 indexes into one block's text
 * (a paragraph or a list item), as the DOM counts them.
 *
 * The passage identity of slice 2 (`lib/passages/sentences.ts`, package
 * S2-A) replaces this when it lands; until then the server stores the
 * snapped offsets as it stores a highlight's.
 */

export type Span = { start: number; end: number }

/** Words whose full stop does not end a sentence. Lower case, no dot. */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'st',
  'mt',
  'jr',
  'sr',
  'prof',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'no',
  'p',
  'pp',
  'vol',
  'fig',
  'approx',
])

/** A single capital and a dot ("J. R. Smith") is an initial, not an end. */
function endsInAbbreviation(segment: string): boolean {
  const match = /(?:^|[\s(“"‘'])([\p{L}.]+)\.\s*$/u.exec(segment)
  if (!match?.[1]) return false
  const word = match[1].toLowerCase()
  return ABBREVIATIONS.has(word) || /^\p{Lu}$/u.test(match[1])
}

function rawSegments(text: string): Span[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    return Array.from(segmenter.segment(text), (s) => ({
      start: s.index,
      end: s.index + s.segment.length,
    }))
  }
  // Older engines: end after . ! ? or … with any closing quotes or
  // brackets, followed by space.
  const spans: Span[] = []
  const end = /[.!?…]+[”’"')\]]*\s+/g
  let start = 0
  for (let match = end.exec(text); match; match = end.exec(text)) {
    spans.push({ start, end: match.index + match[0].length })
    start = match.index + match[0].length
  }
  if (start < text.length) spans.push({ start, end: text.length })
  return spans
}

/**
 * The sentences of a block's text, each without its surrounding space.
 * Abbreviations and initials ("Dr. Ruiz", "J. Reyes") do not end a
 * sentence.
 */
export function sentenceSpans(text: string): Span[] {
  const merged: Span[] = []
  for (const segment of rawSegments(text)) {
    const previous = merged.at(-1)
    if (
      previous &&
      endsInAbbreviation(text.slice(previous.start, previous.end))
    ) {
      previous.end = segment.end
    } else merged.push({ ...segment })
  }
  return merged
    .map(({ start, end }) => {
      const slice = text.slice(start, end)
      const lead = slice.length - slice.trimStart().length
      const trail = slice.length - slice.trimEnd().length
      return { start: start + lead, end: end - trail }
    })
    .filter((span) => span.end > span.start)
}

/**
 * Snaps `[start, end)` to whole sentences of `text`. A collapsed range (a
 * tap) gives the sentence it falls in; one in the space between two
 * sentences gives the next. Null for text with no sentence.
 */
export function snapToSentences(
  text: string,
  start: number,
  end: number = start
): Span | null {
  const spans = sentenceSpans(text)
  if (spans.length === 0) return null
  const from = Math.max(0, Math.min(start, end))
  const to = Math.max(start, end)
  // A tap just after a full stop belongs to the sentence it ends.
  const touching =
    to === from
      ? spans.find((span) => from >= span.start && from <= span.end)
      : undefined
  const first =
    touching ?? spans.find((span) => from < span.end) ?? (spans.at(-1) as Span)
  const last =
    to > from
      ? ([...spans].reverse().find((span) => span.start < to) ?? first)
      : first
  return { start: first.start, end: Math.max(first.end, last.end) }
}
