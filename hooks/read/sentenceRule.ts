/**
 * COPY of the sentence rule of `lib/passages/sentences.ts` from pull request
 * 603 (passage identity, scheme `quilltip-passage-v1`): the canonical text,
 * the sentence splitter and `sentenceRange`, unchanged. One rule for every
 * engine, Node and Convex, with no `Intl.Segmenter`, so offsets and
 * `#s-{p}-{k}` anchors are the same everywhere. Delete this file when 603
 * merges and import from `@/lib/passages/sentences` instead; its vectors
 * test (`scripts/read/sentence-rule.test.ts`) pins this copy to 603's
 * vectors until then.
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
 * Characters that end a sentence when whitespace (or the block end) follows:
 * full stop, exclamation and question marks, ellipsis, interrobang, the
 * Devanagari danda and double danda, the Arabic question mark and the Arabic
 * (Urdu) full stop.
 */
const TERMINATORS = new Set([
  '.',
  '!',
  '?',
  '\u2026',
  '\u203D',
  '\u0964',
  '\u0965',
  '\u061F',
  '\u06D4',
])
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
