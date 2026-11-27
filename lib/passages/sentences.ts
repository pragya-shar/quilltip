/**
 * Passage identity: sentence snapping and a stable `passageId`, one module for
 * the browser, the Convex functions and the counts backfill.
 *
 * Every rule here is plain string code with a fixed list of exceptions. It
 * uses no `Intl.Segmenter`, no locale and no engine-specific behaviour, so the
 * same article gives the same sentences and the same ids in every browser, in
 * Node and in the Convex runtime (the Convex project targets ES2021).
 *
 * Offsets are counted the way highlight offsets are counted today
 * (`convex/lib/tiptapContent.ts`): the characters of the TipTap text nodes in
 * document order, with nothing between blocks. A sentence never crosses a
 * block (paragraph, heading, list item, code block).
 *
 * Identity follows the text, not the position: a passage's id is a hash of
 * the article id and the passage's normalized text. A sentence that moves
 * unchanged keeps its id; a changed sentence gets a new one. When the same
 * text occurs more than once in the article, the passage is ambiguous: its id
 * also includes the sentence indexes, so it never merges with the other copy
 * and it does not survive a move.
 */

/** Bumped only with a new identity rule; old ids stay valid under their own. */
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
  /** `text.slice(start, end)`. */
  text: string
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

/** Characters that end a sentence. */
const TERMINATORS = new Set(['.', '!', '?', '…', '‽'])
/** Full-width terminators end a sentence even with no space after them. */
const WIDE_TERMINATORS = new Set(['。', '！', '？'])
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
 * Words that a full stop follows without ending a sentence. Compared in lower
 * case, without the final stop. Single letters (initials) are handled apart.
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
  'no',
  'nos',
  'fig',
  'figs',
  'vol',
  'pp',
  'ch',
  'e.g',
  'i.e',
  'cf',
  'approx',
])

const WHITESPACE = /\s/

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE.test(ch)
}

/** A cased letter in lower case (Unicode default case mapping, no locale). */
function isLowercaseLetter(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}

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
  if (ABBREVIATIONS.has(word.toLowerCase())) return true
  // An initial: one letter ("J. R. Tolkien").
  if (codePointString(word, 0).length === word.length && /\p{L}/u.test(word))
    return true
  // Dotted single letters ("U.S.", "a.m.").
  if (/^(?:\p{L}\.)+\p{L}$/u.test(word)) return true
  // A list number that opens the sentence ("1. First").
  if (/^\d+$/.test(word) && text.slice(sentenceStart, stop) === word)
    return true
  return false
}

/** Splits one block into sentences, appended to `out`. */
function blockSentences(
  text: string,
  block: CanonicalBlock,
  out: Sentence[]
): void {
  const gaps = new Set(block.gaps)
  const breakAt = (i: number) =>
    i >= block.end || gaps.has(i) || isWhitespace(text[i])
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
    if (end > start) {
      out.push({ index: out.length, start, end, text: text.slice(start, end) })
    }
    i = end
    while (i < block.end && isWhitespace(text[i])) i++
  }
}

/** Closers between the last terminator of the run at `i` and `j`. */
function countClosers(text: string, i: number, j: number): number {
  let n = 0
  while (j - 1 - n > i && CLOSERS.has(text[j - 1 - n]!)) n++
  return n
}

/** The article's sentences, in order, numbered from 0. */
export function sentencesOf(canonical: CanonicalText): Sentence[] {
  const out: Sentence[] = []
  for (const block of canonical.blocks)
    blockSentences(canonical.text, block, out)
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
 * article's own characters, between blocks one space (the same join as a
 * highlight's stored `text`).
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
 * whitespace run as one space, no space at either end.
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
  return normalizePassageText(
    sentences
      .slice(from, to + 1)
      .map((s) => s.text)
      .join(' ')
  )
}

/**
 * Every sentence range whose normalized text equals `quote`, as
 * `[sentenceStart, sentenceEnd]` pairs. Word for word: a near match, or the
 * quote inside a longer sentence, is not a match.
 */
export function findPassage(
  sentences: Sentence[],
  quote: string
): Array<[number, number]> {
  const target = normalizePassageText(quote)
  if (!target) return []
  const found: Array<[number, number]> = []
  for (let from = 0; from < sentences.length; from++) {
    for (let to = from; to < sentences.length; to++) {
      const key = sentenceRangeText(sentences, from, to)
      if (key === target) found.push([from, to])
      if (key.length >= target.length) break
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
 * The passage of an existing highlight row (counts backfill; the highlight
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
  if (passageText(canonical, startOffset, endOffset) !== row.text) return own
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
