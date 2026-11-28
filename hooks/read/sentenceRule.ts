/**
 * COPY of the sentence rule of `lib/passages/sentences.ts` from pull request
 * 603 (passage identity, scheme `quilltip-passage-v1`) at 29206235: the
 * canonical text, the sentence splitter, `sentenceRange` and
 * `normalizePassageText`, unchanged. One rule for every engine, Node and
 * Convex, with no `Intl.Segmenter`, so offsets and `#s-{p}-{k}` anchors are
 * the same everywhere. Delete this file when 603 merges and import from
 * `@/lib/passages/sentences` instead; its vectors test
 * (`scripts/read/sentence-rule.test.ts`) pins this copy to 603's vectors
 * until then. See 603's file header for the rule itself.
 */
export type CanonicalBlock = {
  /** Offset of the block's first character. */
  start: number
  /** Offset after the block's last character. */
  end: number
  /**
   * Offsets inside the block where a non-text node (a hard break, an inline
   * image) sits between two text nodes. Snapping treats each as whitespace.
   */
  gaps: number[]
}

export type CanonicalText = {
  /** The text nodes' characters, concatenated with nothing between blocks. */
  text: string
  blocks: CanonicalBlock[]
}

export type Sentence = {
  index: number
  /** Offset of the first character (never whitespace). */
  start: number
  /** Offset after the last character. */
  end: number
  /** `text.slice(start, end)`, with one space at each hard break inside. */
  text: string
  /** `normalizePassageText(text)`: the form ids and quotes are compared in. */
  key: string
}

export type SentenceRange = {
  sentenceStart: number
  /** Inclusive. */
  sentenceEnd: number
  startOffset: number
  endOffset: number
}

// ---------------------------------------------------------------------------
// Canonical text

type Node = Record<string, unknown>

/**
 * Block types that hold text, the same set as `convex/lib/tiptapContent.ts`.
 * A text node belongs to its nearest enclosing block of one of these types.
 */
const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'listItem',
])

/** The text an article's offsets and sentence indexes are counted in. */
export function canonicalText(content: unknown): CanonicalText {
  let text = ''
  const blocks: CanonicalBlock[] = []
  let currentKey: object | null | undefined
  let current: CanonicalBlock | null = null
  let pendingGap = false

  const visit = (node: unknown, block: object | null) => {
    if (!node || typeof node !== 'object') return
    const record = node as Node
    if (record.type === 'text' && typeof record.text === 'string') {
      if (record.text.length === 0) return
      if (!current || currentKey !== block) {
        current = { start: text.length, end: text.length, gaps: [] }
        currentKey = block
        blocks.push(current)
      } else if (pendingGap) {
        current.gaps.push(text.length)
      }
      pendingGap = false
      text += record.text
      current.end = text.length
      return
    }
    const children = Array.isArray(record.content) ? record.content : []
    const ownBlock =
      typeof record.type === 'string' && TEXT_BLOCK_TYPES.has(record.type)
        ? record
        : block
    if (children.length === 0) {
      // A leaf that is not text (hard break, image) separates words.
      if (ownBlock === block) pendingGap = true
      return
    }
    for (const child of children) visit(child, ownBlock)
  }

  visit(content, null)
  return { text, blocks }
}

// ---------------------------------------------------------------------------
// Sentences

/**
 * Characters that end a sentence when whitespace, a hard break or the block
 * end follows: full stop, exclamation and question marks, ellipsis,
 * interrobang, the Devanagari danda (U+0964) and double danda (U+0965), the
 * Arabic question mark (U+061F), the Arabic full stop (U+06D4), the Armenian
 * full stop (U+0589) and the Greek question mark (U+037E).
 */
const TERMINATORS = new Set([
  '.',
  '!',
  '?',
  '…',
  '‽',
  '।',
  '॥',
  '؟',
  '۔',
  '։',
  ';',
])
/**
 * Terminators that end a sentence with no space after them: the ideographic
 * full stop (U+3002), the full-width exclamation and question marks (U+FF01,
 * U+FF1F), the full-width full stop (U+FF0E) and the half-width ideographic
 * full stop (U+FF61).
 */
const WIDE_TERMINATORS = new Set(['。', '！', '？', '．', '｡'])
/** Characters that may follow a terminator and still belong to its sentence. */
const CLOSERS = new Set([
  '"',
  "'",
  ')',
  ']',
  '}',
  '’',
  '”',
  '»',
  '›',
  '」',
  '』',
  '）',
])
/** Opening marks stripped from the front of a word before the checks. */
const OPENERS = /^["'([{‘“«‹]+/

/**
 * Words that a full stop follows without ending the sentence, whatever comes
 * next (titles and Latin abbreviations). Lower case, without the final stop.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'mx',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'mt',
  'vs',
  'e.g',
  'i.e',
  'cf',
  'approx',
])

/**
 * Words that keep the sentence open only before a number ("no. 5", "fig. 3"),
 * because they are also ordinary words at the end of a sentence.
 */
const NUMBER_ABBREVIATIONS = new Set([
  'no',
  'nos',
  'fig',
  'figs',
  'vol',
  'pp',
  'ch',
  'p',
])

/**
 * Whitespace: exactly the characters JavaScript's `\s` matches (U+0009 to
 * U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F,
 * U+205F, U+3000, U+FEFF). U+0085 and U+200B are not whitespace here.
 */
const WHITESPACE = /\s/

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE.test(ch)
}

/** A cased letter in lower case (Unicode default case mapping, no locale). */
function isLowercaseLetter(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

/** A cased letter in upper case. */
function isUppercaseLetter(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase()
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** The code point at `i` as a string (one or two UTF-16 units). */
function codePointString(text: string, i: number): string {
  const cp = text.codePointAt(i)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

/** The word that ends at `stop` (exclusive), without opening marks. */
function wordBefore(text: string, from: number, stop: number): string {
  let i = stop
  while (i > from && !isWhitespace(text[i - 1])) i--
  return text.slice(i, stop).replace(OPENERS, '')
}

/** True when the stop at `stop` does not end the sentence. */
function keepsSentenceOpen(
  text: string,
  sentenceStart: number,
  stop: number,
  next: string
): boolean {
  if (next !== '' && isLowercaseLetter(next)) return true
  if (text[stop] !== '.') return false
  const word = wordBefore(text, sentenceStart, stop)
  if (word.length === 0) return false
  const lower = word.toLowerCase()
  if (ABBREVIATIONS.has(lower)) return true
  if (NUMBER_ABBREVIATIONS.has(lower)) return /^\p{N}/u.test(next)
  // An initial: one letter ("J. R. Tolkien").
  if (codePointString(word, 0).length === word.length && /\p{L}/u.test(word))
    return true
  // Dotted letters ("U.S.", "a.m."): open unless a capital letter follows.
  if (/^(?:\p{L}\.)+\p{L}$/u.test(word)) return !isUppercaseLetter(next)
  // A list number that opens the sentence ("1. First").
  if (/^\d+$/.test(word) && text.slice(sentenceStart, stop) === word)
    return true
  return false
}

/** Closers between the last terminator of the run at `i` and `j`. */
function countClosers(text: string, i: number, j: number): number {
  let n = 0
  while (j - 1 - n > i && CLOSERS.has(text[j - 1 - n]!)) n++
  return n
}

/** `text.slice(start, end)` with one space at each hard break inside. */
function textWithBreaks(
  text: string,
  gaps: number[],
  start: number,
  end: number
): string {
  let out = ''
  let at = start
  for (const gap of gaps) {
    if (gap <= start || gap >= end) continue
    out += `${text.slice(at, gap)} `
    at = gap
  }
  return out + text.slice(at, end)
}

/** Splits one block into `[start, end)` pieces at sentence ends. */
function blockPieces(
  text: string,
  block: CanonicalBlock
): Array<[number, number]> {
  const gaps = new Set(block.gaps)
  const breakAt = (i: number) =>
    i >= block.end || gaps.has(i) || isWhitespace(text[i])
  const pieces: Array<[number, number]> = []
  let i = block.start
  while (i < block.end && isWhitespace(text[i])) i++
  while (i < block.end) {
    const start = i
    let end = -1
    while (i < block.end) {
      const ch = text[i]!
      if (WIDE_TERMINATORS.has(ch)) {
        let j = i + 1
        while (
          j < block.end &&
          (WIDE_TERMINATORS.has(text[j]!) || CLOSERS.has(text[j]!))
        )
          j++
        end = j
        break
      }
      if (TERMINATORS.has(ch)) {
        let j = i + 1
        while (j < block.end && TERMINATORS.has(text[j]!)) j++
        while (j < block.end && CLOSERS.has(text[j]!)) j++
        if (breakAt(j)) {
          let k = j
          while (k < block.end && isWhitespace(text[k])) k++
          const next = k < block.end ? codePointString(text, k) : ''
          if (
            !keepsSentenceOpen(
              text,
              start,
              j - 1 - countClosers(text, i, j),
              next
            )
          ) {
            end = j
            break
          }
        }
        i = j
        continue
      }
      i++
    }
    if (end === -1) {
      end = block.end
      while (end > start && isWhitespace(text[end - 1])) end--
    }
    if (end > start) pieces.push([start, end])
    i = end
    while (i < block.end && isWhitespace(text[i])) i++
  }
  return pieces
}

/**
 * A sentence needs a letter or a digit: a piece of punctuation only (". . .",
 * "?!") joins the sentence before it in the block, or the one after it when it
 * opens the block. A block with no letter or digit at all is one sentence.
 */
function mergePunctuation(
  text: string,
  pieces: Array<[number, number]>
): Array<[number, number]> {
  const hasWord = (p: [number, number]) =>
    LETTER_OR_DIGIT.test(text.slice(p[0], p[1]))
  if (!pieces.some(hasWord)) {
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    return first && last ? [[first[0], last[1]]] : []
  }
  const out: Array<[number, number]> = []
  let pending: number | null = null
  for (const piece of pieces) {
    if (!hasWord(piece)) {
      const previous = out[out.length - 1]
      if (previous) previous[1] = piece[1]
      else pending ??= piece[0]
      continue
    }
    out.push([pending ?? piece[0], piece[1]])
    pending = null
  }
  return out
}

/** The article's sentences, in order, numbered from 0. */
export function sentencesOf(canonical: CanonicalText): Sentence[] {
  const out: Sentence[] = []
  for (const block of canonical.blocks) {
    for (const [start, end] of mergePunctuation(
      canonical.text,
      blockPieces(canonical.text, block)
    )) {
      const text = textWithBreaks(canonical.text, block.gaps, start, end)
      out.push({
        index: out.length,
        start,
        end,
        text,
        key: normalizePassageText(text),
      })
    }
  }
  return out
}

/**
 * Extends `[start, end)` to whole sentences. A tap (`start === end`) picks
 * the sentence that contains the offset. Returns null when the range touches
 * no sentence (only whitespace, or outside the text).
 */
export function sentenceRange(
  sentences: Sentence[],
  start: number,
  end: number
): SentenceRange | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
  if (end < start) return null
  const hits = sentences.filter((s) =>
    start === end
      ? start >= s.start && start < s.end
      : s.end > start && s.start < end
  )
  const first = hits[0]
  const last = hits[hits.length - 1]
  if (!first || !last) return null
  return {
    sentenceStart: first.index,
    sentenceEnd: last.index,
    startOffset: first.start,
    endOffset: last.end,
  }
}

/**
 * The form a passage's text is compared and hashed in: Unicode NFC, every
 * whitespace run (the set listed at `WHITESPACE`) as one U+0020, no space at
 * either end.
 */
export function normalizePassageText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}
