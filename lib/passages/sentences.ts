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
 * vectors (`lib/passages/vectors/identity-v1.json`), run in real browser
 * engines as well as here.
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
 * 4. The sentence rule (`sentencesOf`):
 *    a. A sentence ends after a terminator run (`TERMINATORS`) and any closing
 *       marks (`CLOSERS`) when whitespace, a hard break or the block end
 *       follows; after a wide terminator (`WIDE_TERMINATORS`) it ends at once.
 *    b. It does not end there when the next character after the whitespace is
 *       a lower-case letter; or, for a full stop, when the word before it is in
 *       `ABBREVIATIONS`, is in `NUMBER_ABBREVIATIONS` and a digit follows, is
 *       one letter (an initial), is dotted letters ("U.S.", "a.m.") and no
 *       capital letter follows, or is a number that opens the sentence.
 *    c. A piece with no letter or digit joins the sentence before it in its
 *       block (the one after it when it opens the block); a block with no
 *       letter or digit at all is one sentence.
 *
 * Any change to 1 to 4 that can change a stored id needs a new scheme string;
 * ids stored under an old scheme keep meaning what that scheme said.
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
 * Every sentence range whose normalized text equals `quote`, as
 * `[sentenceStart, sentenceEnd]` pairs. Word for word: a near match, or the
 * quote inside a longer sentence, is not a match. A range is tried only from
 * a sentence the quote starts with, and grown only while the quote still
 * starts with it, so the cost is about the article's length.
 */
export function findPassage(
  sentences: Sentence[],
  quote: string
): Array<[number, number]> {
  const target = normalizePassageText(quote)
  if (!target) return []
  const found: Array<[number, number]> = []
  for (let from = 0; from < sentences.length; from++) {
    const head = sentences[from]!.key
    if (head !== target && !target.startsWith(`${head} `)) continue
    let joined = head
    for (let to = from; ; ) {
      if (joined === target) {
        found.push([from, to])
        break
      }
      to++
      const next = sentences[to]
      if (!next) break
      joined = `${joined} ${next.key}`
      if (joined !== target && !target.startsWith(`${joined} `)) break
    }
  }
  return found
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

/** Names an already snapped range. */
export async function identifyRange(
  articleId: string,
  canonical: CanonicalText,
  sentences: Sentence[],
  range: SentenceRange
): Promise<PassageIdentity> {
  const key = sentenceRangeText(
    sentences,
    range.sentenceStart,
    range.sentenceEnd
  )
  const ambiguous = findPassage(sentences, key).length > 1
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
 * never merges with another. Writes nothing.
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
