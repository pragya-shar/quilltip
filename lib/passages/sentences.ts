/**
 * Passage identity: sentence snapping and a stable `passageId`, one module for
 * the browser, the Convex functions and a later backfill of passage counts.
 *
 * Every rule here is plain string code with fixed lists of characters and
 * exceptions. It uses no `Intl.Segmenter` and no locale, so the same article
 * gives the same sentences and ids in every browser, in Node and in the Convex
 * runtime (the Convex project targets ES2021). One limit: the rule calls
 * `toUpperCase`/`toLowerCase`, `\p{L}`/`\p{N}` and NFC, which follow each
 * engine's Unicode tables, so a character added in a newer Unicode version
 * than an engine knows may be read differently there. The guard is the shared
 * vectors (`lib/passages/vectors/identity-v1.json`): the tests here run them in
 * the edge runtime; a browser run lives with the article view's suite, not in
 * this change.
 *
 * Offsets are counted the way highlight offsets are counted today
 * (`convex/lib/tiptapContent.ts`): the characters of the TipTap text nodes in
 * document order, with nothing between blocks and nothing at a hard break. A
 * sentence never crosses a block (paragraph, heading, list item, code block).
 *
 * Identity follows the text, not the position: a passage's id is a hash of
 * the article id and the passage's normalized text. A sentence that moves
 * unchanged keeps its id; a changed sentence gets a new one. When the same
 * text occurs more than once in the article, the passage is ambiguous: its id
 * also includes the sentence indexes, so it never merges with the other copy
 * and it does not survive a move.
 *
 * Scheme `quilltip-passage-v1` fixes, exactly:
 *
 * 1. Sentence text (`Sentence.text`): the characters from the sentence's start
 *    to its end offset, with one U+0020 inserted at each hard break (or other
 *    non-text inline node) inside. A passage's text is its sentences' texts
 *    joined by one U+0020.
 * 2. Normalisation (`normalizePassageText`), in this order: Unicode NFC
 *    (`String.prototype.normalize('NFC')`); every run of whitespace replaced
 *    by one U+0020, where whitespace is exactly U+0009 to U+000D, U+0020,
 *    U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F,
 *    U+3000 and U+FEFF (JavaScript's `\s`; U+0085 and U+200B are not in it
 *    and are kept); leading and trailing spaces removed. Nothing else: letter
 *    case is kept, and quotation marks, apostrophes, dashes and every other
 *    character are kept as written (a curly quote and a straight quote give
 *    different ids).
 * 3. The id: the first 28 lowercase hex characters of SHA-256 over the UTF-8
 *    bytes of `quilltip-passage-v1` + LF + article id + LF + normalised text.
 *    An ambiguous passage hashes `quilltip-passage-v1:at` + LF + article id +
 *    LF + `<sentenceStart>:<sentenceEnd>` + LF + normalised text.
 * 4. The sentence rule (`sentencesOf`). Offsets stay those of the article's
 *    characters as stored, but every decision is the one the rule makes on
 *    the NFC form, so canonically equivalent text (precomposed or decomposed
 *    accents) always splits the same way: the characters the rule looks at
 *    one by one (terminators, closers, openers, whitespace, digits) are ones
 *    NFC leaves in the same class, and the word before a stop is read in NFC.
 *    a. A sentence ends after a terminator run (`TERMINATORS`) and any closing
 *       marks (`CLOSERS`) when whitespace, a hard break or the block end
 *       follows; after a wide terminator (`WIDE_TERMINATORS`) it ends at once.
 *       A semicolon never ends a sentence, and so neither does the Greek
 *       question mark U+037E, whose NFC form is the semicolon U+003B.
 *    b. It does not end there when the next character after the whitespace is
 *       a lower-case letter, where a letter is lower case when it differs from
 *       its upper case and equals its lower case, except Georgian Mkhedruli
 *       (U+10D0 to U+10FF), which counts as uncased.
 *    c. For a full stop, it does not end there either when the word before
 *       the stop is in `ABBREVIATIONS`; is in `NUMBER_ABBREVIATIONS` and a
 *       digit follows; is one letter (an initial, so also "p. 5"); is dotted
 *       letters ("U.S.", "a.m.": they never end a sentence by themselves, so
 *       "He lives in the U.S. The weather is fine." is one sentence); or is a
 *       number (decimal digits `\p{Nd}`, any script) that opens the sentence
 *       ("1. First", "१. पहला"). The word before a stop runs back to
 *       whitespace, a hard break or the sentence start; it is read for at
 *       most `MAX_WORD_LOOKBACK` characters that are not combining marks, and
 *       with no run of more than `MAX_COMBINING_MARK_RUN` marks: a longer
 *       word is none of these. It is taken in NFC, and opening marks
 *       (`OPENERS`) are removed from it.
 *    d. The full-width full stop U+FF0E does not end a sentence between two
 *       decimal digits ("３．１４") or after a number that opens the sentence
 *       ("１．はじめに").
 *    e. A piece with no letter or digit joins the sentence before it in its
 *       block (the one after it when it opens the block); a block with no
 *       letter or digit at all is one sentence.
 *
 * Any change to 1 to 4 that can change a stored id needs, once ids of this
 * scheme are stored: a new scheme string; a new vectors file beside
 * `identity-v1.json` (the old file stays, for rows of the old scheme); and
 * every stored id either recomputed under the new scheme or stored with the
 * scheme that made it. Ids stored under an old scheme keep meaning what that
 * scheme said.
 */

/** Names the identity rule above; see the header for what it fixes. */
export const PASSAGE_ID_SCHEME = 'quilltip-passage-v1'

/** Hex characters kept from the SHA-256 digest (the highlight id's length). */
export const PASSAGE_ID_LENGTH = 28

/** Prefix of an existing highlight row's own passage (`legacyPassageOf`). */
export const LEGACY_PASSAGE_PREFIX = 'legacy:'

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

export type PassageIdentity = SentenceRange & {
  passageId: string
  /** The passage's text as a reader sees it (blocks joined by one space). */
  text: string
  /** The same text occurs at another sentence range of the article. */
  ambiguous: boolean
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
 * Arabic question mark (U+061F), the Arabic full stop (U+06D4) and the
 * Armenian full stop (U+0589). Not the Greek question mark (U+037E): its NFC
 * form is the semicolon, which never ends a sentence (rule 4).
 */
const TERMINATORS = new Set(['.', '!', '?', '…', '‽', '।', '॥', '؟', '۔', '։'])
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
 * because they are also ordinary words at the end of a sentence. One-letter
 * words ("p. 5") need no entry: the initial rule keeps them open.
 */
const NUMBER_ABBREVIATIONS = new Set([
  'no',
  'nos',
  'fig',
  'figs',
  'vol',
  'pp',
  'ch',
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

/**
 * A cased letter in lower case (Unicode default case mapping, no locale).
 * Georgian Mkhedruli (U+10D0 to U+10FF) is excluded: it is written without
 * case, although engines map it to Mtavruli in upper case.
 */
function isLowercaseLetter(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 0x10d0 && cp <= 0x10ff) return false
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const DECIMAL_DIGIT = /^\p{Nd}$/u
const DIGITS = /^\p{Nd}+$/u

/**
 * The longest word read back from a stop (rule 4c), in characters that are
 * not combining marks, so a precomposed and a decomposed word count alike.
 */
export const MAX_WORD_LOOKBACK = 32

/**
 * The longest run of combining marks (`\p{M}`) a searchable text may hold.
 * NFC is slow on longer runs, so the share paths refuse such an article and
 * `legacyPassageOf` does not snap in one (see `hasLongCombiningRun`).
 */
export const MAX_COMBINING_MARK_RUN = 32
const LONG_COMBINING_RUN = new RegExp(
  `\\p{M}{${MAX_COMBINING_MARK_RUN + 1},}`,
  'u'
)
const COMBINING_MARK = /^\p{M}$/u

/** True when `text` has a run of more than `MAX_COMBINING_MARK_RUN` marks. */
export function hasLongCombiningRun(text: string): boolean {
  return LONG_COMBINING_RUN.test(text)
}

/** The full-width full stop, which is also a decimal point (rule 4d). */
const FULL_WIDTH_STOP = '\uff0e'

/** The code point at `i` as a string (one or two UTF-16 units). */
function codePointString(text: string, i: number): string {
  const cp = text.codePointAt(i)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

/**
 * The word that ends at `stop` (exclusive): back to whitespace, a hard break
 * (`gaps`) or `from`, in NFC, with opening marks removed. Null when it has
 * more than `MAX_WORD_LOOKBACK` characters that are not combining marks, or
 * a run of marks longer than `MAX_COMBINING_MARK_RUN`. `opensSentence`: it
 * starts at `from` with no opening mark.
 */
function wordBefore(
  text: string,
  from: number,
  stop: number,
  gaps: Set<number>
): { word: string; opensSentence: boolean } | null {
  let i = stop
  let letters = 0
  let marks = 0
  while (i > from && !isWhitespace(text[i - 1]) && !gaps.has(i)) {
    // One code point back (a surrogate pair is one).
    const low = text.charCodeAt(i - 1)
    const step =
      low >= 0xdc00 &&
      low <= 0xdfff &&
      i - 2 >= from &&
      text.charCodeAt(i - 2) >= 0xd800 &&
      text.charCodeAt(i - 2) <= 0xdbff
        ? 2
        : 1
    if (COMBINING_MARK.test(text.slice(i - step, i))) {
      if (++marks > MAX_COMBINING_MARK_RUN) return null
    } else {
      if (++letters > MAX_WORD_LOOKBACK) return null
      marks = 0
    }
    i -= step
  }
  const raw = text.slice(i, stop).normalize('NFC')
  const word = raw.replace(OPENERS, '')
  return { word, opensSentence: i === from && word === raw }
}

/** True when the stop at `stop` does not end the sentence. */
function keepsSentenceOpen(
  text: string,
  sentenceStart: number,
  stop: number,
  next: string,
  gaps: Set<number>
): boolean {
  if (next !== '' && isLowercaseLetter(next)) return true
  if (text[stop] !== '.') return false
  const before = wordBefore(text, sentenceStart, stop, gaps)
  if (!before || before.word.length === 0) return false
  const { word } = before
  const lower = word.toLowerCase()
  if (ABBREVIATIONS.has(lower)) return true
  if (NUMBER_ABBREVIATIONS.has(lower)) return /^\p{N}/u.test(next)
  // An initial: one letter ("J. R. Tolkien", "p. 5").
  if (codePointString(word, 0).length === word.length && /\p{L}/u.test(word))
    return true
  // Dotted letters ("U.S.", "a.m.") never end a sentence by themselves.
  if (/^(?:\p{L}\.)+\p{L}$/u.test(word)) return true
  // A list number that opens the sentence ("1. First", "१. पहला").
  if (DIGITS.test(word) && before.opensSentence) return true
  return false
}

/** True when the full-width stop at `i` is a decimal point or a list number. */
function fullWidthStopKeepsOpen(
  text: string,
  sentenceStart: number,
  i: number,
  blockEnd: number,
  gaps: Set<number>
): boolean {
  const prev = i > sentenceStart && !gaps.has(i) ? text[i - 1]! : ''
  const next = i + 1 < blockEnd && !gaps.has(i + 1) ? text[i + 1]! : ''
  if (DECIMAL_DIGIT.test(prev) && DECIMAL_DIGIT.test(next)) return true
  const before = wordBefore(text, sentenceStart, i, gaps)
  return !!before && before.opensSentence && DIGITS.test(before.word)
}

/** Closers between the last terminator of the run at `i` and `j`. */
function countClosers(text: string, i: number, j: number): number {
  let n = 0
  while (j - 1 - n > i && CLOSERS.has(text[j - 1 - n]!)) n++
  return n
}

/** The index of the first gap after `start` in the sorted `gaps`. */
function firstGapAfter(gaps: number[], start: number): number {
  let lo = 0
  let hi = gaps.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (gaps[mid]! <= start) lo = mid + 1
    else hi = mid
  }
  return lo
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
  for (let g = firstGapAfter(gaps, start); g < gaps.length; g++) {
    const gap = gaps[g]!
    if (gap >= end) break
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
        if (
          ch === FULL_WIDTH_STOP &&
          fullWidthStopKeepsOpen(text, start, i, block.end, gaps)
        ) {
          i++
          continue
        }
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
              next,
              gaps
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

/** The range of sentences `[from, to]`, or null when out of bounds. */
export function rangeOfSentences(
  sentences: Sentence[],
  from: number,
  to: number
): SentenceRange | null {
  const first = sentences[from]
  const last = sentences[to]
  if (!first || !last || to < from) return null
  return {
    sentenceStart: from,
    sentenceEnd: to,
    startOffset: first.start,
    endOffset: last.end,
  }
}

/**
 * The text of an offset range as a reader sees it: within a block the
 * article's own characters with one space at each hard break, between blocks
 * one space (the same join as a highlight's stored `text`).
 */
export function passageText(
  canonical: CanonicalText,
  startOffset: number,
  endOffset: number
): string {
  const parts: string[] = []
  for (const block of canonical.blocks) {
    if (block.end <= startOffset || block.start >= endOffset) continue
    parts.push(
      textWithBreaks(
        canonical.text,
        block.gaps,
        Math.max(block.start, startOffset),
        Math.min(block.end, endOffset)
      )
    )
  }
  return parts.join(' ')
}

/**
 * The text a highlight row stores for an offset range
 * (`convex/lib/tiptapContent.ts`): the characters of the range, nothing at a
 * hard break, one space between blocks. Only for comparing with such rows.
 */
export function highlightTextAt(
  canonical: CanonicalText,
  startOffset: number,
  endOffset: number
): string {
  const parts: string[] = []
  for (const block of canonical.blocks) {
    if (block.end <= startOffset || block.start >= endOffset) continue
    parts.push(
      canonical.text.slice(
        Math.max(block.start, startOffset),
        Math.min(block.end, endOffset)
      )
    )
  }
  return parts.join(' ')
}

/**
 * The form a passage's text is compared and hashed in: Unicode NFC, every
 * whitespace run (the set listed at `WHITESPACE`) as one U+0020, no space at
 * either end.
 */
export function normalizePassageText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** The normalized text of sentences `[from, to]`. */
export function sentenceRangeText(
  sentences: Sentence[],
  from: number,
  to: number
): string {
  return sentences
    .slice(from, to + 1)
    .map((s) => s.key)
    .join(' ')
}

/**
 * The article's sentence keys joined by one space, with where each key starts
 * and ends in it and a rolling hash of every prefix: built once per article
 * (linear), so each search tries every sentence start in constant time.
 */
export type PassageIndex = {
  joined: string
  /** `starts[i]`: where sentence `i`'s key starts in `joined`. */
  starts: number[]
  /** `endAt[p]`: the sentence whose key ends at offset `p`, else -1. */
  endAt: Int32Array
  /** `prefix[p]`: the hash of `joined.slice(0, p)`. */
  prefix: Float64Array
  /** The hash's base, drawn at random per index, so no text is made to collide. */
  base: number
}

/**
 * A prime below 2^26, so every product in the hash stays below 2^52 and is
 * exact in a double. The hash only skips candidates; a match is always
 * confirmed character by character.
 */
const HASH_MODULUS = 67_108_859

export function passageIndexOf(sentences: Sentence[]): PassageIndex {
  const joined = sentences.map((s) => s.key).join(' ')
  const starts: number[] = []
  const endAt = new Int32Array(joined.length + 1).fill(-1)
  let at = 0
  for (const s of sentences) {
    starts.push(at)
    at += s.key.length
    endAt[at] = s.index
    at += 1
  }
  const base = 256 + Math.floor(Math.random() * (HASH_MODULUS - 512))
  const prefix = new Float64Array(joined.length + 1)
  for (let p = 0; p < joined.length; p++) {
    prefix[p + 1] = (prefix[p]! * base + joined.charCodeAt(p)) % HASH_MODULUS
  }
  return { joined, starts, endAt, prefix, base }
}

function asIndex(source: Sentence[] | PassageIndex): PassageIndex {
  return Array.isArray(source) ? passageIndexOf(source) : source
}

/** The hash of `text` and `base ** text.length`, both mod `HASH_MODULUS`. */
function hashOf(text: string, base: number): [number, number] {
  let hash = 0
  let power = 1
  for (let p = 0; p < text.length; p++) {
    hash = (hash * base + text.charCodeAt(p)) % HASH_MODULUS
    power = (power * base) % HASH_MODULUS
  }
  return [hash, power]
}

/** True when `joined.slice(at, at + length)` hashes to `hash`. */
function hashMatches(
  index: PassageIndex,
  at: number,
  length: number,
  hash: number,
  power: number
): boolean {
  const { prefix } = index
  const head = (prefix[at]! * power) % HASH_MODULUS
  const slice = (prefix[at + length]! - head + HASH_MODULUS) % HASH_MODULUS
  return slice === hash
}

/**
 * Every sentence range whose normalized text equals `quote`, as
 * `[sentenceStart, sentenceEnd]` pairs in order, at most `limit` of them.
 * Word for word: a near match, or the quote inside a longer sentence, is not
 * a match. Each sentence start costs constant time (the quote must end at a
 * sentence end there, and its hash must match before the characters are
 * compared), so a search costs about the number of sentences plus the
 * quote's length.
 */
export function findPassage(
  source: Sentence[] | PassageIndex,
  quote: string,
  limit = Number.POSITIVE_INFINITY
): Array<[number, number]> {
  const target = normalizePassageText(quote)
  if (!target || limit < 1) return []
  const index = asIndex(source)
  const { joined, starts, endAt } = index
  const [hash, power] = hashOf(target, index.base)
  const found: Array<[number, number]> = []
  for (let from = 0; from < starts.length; from++) {
    const at = starts[from]!
    if (at + target.length > joined.length) break
    const to = endAt[at + target.length]!
    if (to < from) continue
    if (!hashMatches(index, at, target.length, hash, power)) continue
    if (!joined.startsWith(target, at)) continue
    found.push([from, to])
    if (found.length >= limit) break
  }
  return found
}

/** True when sentences `[from, to]` read exactly `quote` (normalized). */
export function passageMatchesAt(
  source: Sentence[] | PassageIndex,
  quote: string,
  from: number,
  to: number
): boolean {
  const target = normalizePassageText(quote)
  const { joined, starts, endAt } = asIndex(source)
  const at = starts[from]
  if (!target || at === undefined || at + target.length > joined.length)
    return false
  return endAt[at + target.length] === to && joined.startsWith(target, at)
}

// ---------------------------------------------------------------------------
// Ids

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data) as BufferSource
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The id of a passage. Unique text: `sha256(scheme \n articleId \n text)`.
 * Text that occurs more than once in the article: the sentence indexes are
 * hashed too, under their own label, so the copies never share an id.
 */
export async function passageIdOf(
  articleId: string,
  normalizedText: string,
  position: { ambiguous: boolean; sentenceStart: number; sentenceEnd: number }
): Promise<string> {
  const input = position.ambiguous
    ? `${PASSAGE_ID_SCHEME}:at\n${articleId}\n${position.sentenceStart}:${position.sentenceEnd}\n${normalizedText}`
    : `${PASSAGE_ID_SCHEME}\n${articleId}\n${normalizedText}`
  return (await sha256Hex(input)).slice(0, PASSAGE_ID_LENGTH)
}

/** Names an already snapped range. Pass `index` to reuse a built one. */
export async function identifyRange(
  articleId: string,
  canonical: CanonicalText,
  sentences: Sentence[],
  range: SentenceRange,
  index?: PassageIndex
): Promise<PassageIdentity> {
  const key = sentenceRangeText(
    sentences,
    range.sentenceStart,
    range.sentenceEnd
  )
  const ambiguous = findPassage(index ?? sentences, key, 2).length > 1
  return {
    ...range,
    passageId: await passageIdOf(articleId, key, { ...range, ambiguous }),
    text: passageText(canonical, range.startOffset, range.endOffset),
    ambiguous,
  }
}

/** Snaps a selection and names the passage. Null when nothing is selected. */
export async function identifyPassage(
  articleId: string,
  canonical: CanonicalText,
  sentences: Sentence[],
  start: number,
  end: number
): Promise<PassageIdentity | null> {
  const range = sentenceRange(sentences, start, end)
  if (!range) return null
  return identifyRange(articleId, canonical, sentences, range)
}

/**
 * The passage of an existing highlight row (for a later backfill; the highlight
 * tables later). The row's offsets are mapped onto the article's current
 * text: when the text there still equals the row's stored `text`, the row
 * joins the snapped passage; otherwise (the article was edited, the offsets
 * are unknown) it keeps a passage of its own, `legacy:<highlightId>`, which
 * never merges with another. It also keeps its own passage in an article
 * with a run of more than `MAX_COMBINING_MARK_RUN` combining marks, which is
 * not split. Writes nothing.
 */
export async function legacyPassageOf(
  row: {
    highlightId: string
    text: string
    startOffset?: number | null
    endOffset?: number | null
  },
  article: { _id: string; content: unknown }
): Promise<{ passageId: string; range: SentenceRange | null }> {
  const own = {
    passageId: `${LEGACY_PASSAGE_PREFIX}${row.highlightId}`,
    range: null,
  }
  const { startOffset, endOffset } = row
  if (
    typeof startOffset !== 'number' ||
    typeof endOffset !== 'number' ||
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  )
    return own
  const canonical = canonicalText(article.content)
  if (endOffset > canonical.text.length) return own
  // Too slow to split (NFC on a long run of marks): the row keeps its own.
  if (hasLongCombiningRun(canonical.text)) return own
  if (highlightTextAt(canonical, startOffset, endOffset) !== row.text)
    return own
  const sentences = sentencesOf(canonical)
  const identity = await identifyPassage(
    String(article._id),
    canonical,
    sentences,
    startOffset,
    endOffset
  )
  if (!identity) return own
  return {
    passageId: identity.passageId,
    range: {
      sentenceStart: identity.sentenceStart,
      sentenceEnd: identity.sentenceEnd,
      startOffset: identity.startOffset,
      endOffset: identity.endOffset,
    },
  }
}
