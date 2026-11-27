/**
 * The rule that chooses which article opens Today. Pure functions, so the
 * query and its tests share them. The rule and its reasons are written down
 * in docs/architecture/v3/today-opening.md.
 *
 * In short: time is cut into windows of WINDOW_MS. The candidates are the
 * newest article of each writer among the newest published articles, each
 * with a real body, published before the window began. Each candidate gets a
 * score from a hash of (window, article id); the lowest score opens Today,
 * the next ones are "more to read". Tips play no part: every writer gets the
 * opening equally often, with or without tips.
 */

/** One UTC day: the place is called Today, and its opening is the
 * same for everyone that day. */
export const WINDOW_MS = 24 * 60 * 60 * 1000

/** Reading speed for "N min left". */
export const WORDS_PER_MINUTE = 230

/**
 * Candidates are read in pages of CANDIDATE_PAGE articles, newest first,
 * until enough distinct writers are eligible or CANDIDATE_PAGES pages were
 * read: at most 400 articles per call, however the catalogue is shaped.
 */
export const CANDIDATE_PAGE = 50
export const CANDIDATE_PAGES = 8

/** Articles a reader opened or finished that the caller may ask to skip:
 * the two cookies, at most 20 ids each. */
export const EXCLUDE_LIMIT = 40

/** "More to read" after the opening: a list of 12 that ends. */
export const MORE_LIMIT = 12

/** An article needs at least this many body paragraphs to open Today. */
export const MIN_PARAGRAPHS = 2

/** The opening shows whole paragraphs up to this many words, never more. */
export const OPENING_WORDS = 220

export function windowOf(at: number) {
  const index = Math.floor(at / WINDOW_MS)
  return { index, startsAt: index * WINDOW_MS, endsAt: (index + 1) * WINDOW_MS }
}

/** FNV-1a, 32 bit: small, stable across runtimes, good enough to spread ids. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Lower opens first. The id breaks the rare tie, so the order is total. */
export function compareForWindow(window: number) {
  return (a: string, b: string) => {
    const diff = fnv1a(`${window}:${a}`) - fnv1a(`${window}:${b}`)
    return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0
  }
}

type Node = { type?: unknown; text?: unknown; content?: unknown }

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as Node
  if (record.type === 'text' && typeof record.text === 'string')
    return record.text
  if (record.type === 'hardBreak') return ' '
  if (!Array.isArray(record.content)) return ''
  return record.content.map(textOf).join('')
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

const wordCount = (text: string) =>
  text ? text.split(' ').filter(Boolean).length : 0

/** Every word of an article's text, in any block (a draft's length). */
export function countWords(content: unknown): number {
  return wordCount(clean(textOf(content)))
}

/**
 * The article's body as plain paragraphs: top-level paragraphs and the
 * paragraphs inside top-level quotes, in order. Headings, lists, images,
 * embeds and code are not part of an opening.
 */
export function bodyParagraphs(content: unknown): string[] {
  if (!content || typeof content !== 'object') return []
  const blocks = (content as Node).content
  if (!Array.isArray(blocks)) return []
  const paragraphs: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const type = (block as Node).type
    if (type === 'paragraph') {
      const text = clean(textOf(block))
      if (text) paragraphs.push(text)
    } else if (type === 'blockquote') {
      const inner = (block as Node).content
      if (!Array.isArray(inner)) continue
      for (const child of inner) {
        if ((child as Node)?.type !== 'paragraph') continue
        const text = clean(textOf(child))
        if (text) paragraphs.push(text)
      }
    }
  }
  return paragraphs
}

/**
 * Minutes left to read: the words still ahead, at 230 a minute,
 * rounded up; 0 when none are left. A pure function of the article's length
 * and the reader's position: the opening passes the words after the shown
 * paragraphs, and a server-side reading position can pass the words after
 * the reader's place.
 */
export function minutesLeft(remainingWords: number): number {
  if (!(remainingWords > 0)) return 0
  return Math.ceil(remainingWords / WORDS_PER_MINUTE)
}

/** A paragraph cut to at most `max` words: at the last sentence end that
 * fits, else at a word with an ellipsis. */
function cutToWords(text: string, max: number): string {
  const words = text.split(' ')
  const head = words.slice(0, max).join(' ')
  const sentenceEnd = head.match(/^.*[.!?…](?=\s|$)/u)?.[0]
  if (sentenceEnd && wordCount(sentenceEnd) >= max / 2) return sentenceEnd
  return `${head}…`
}

/**
 * The opening of an article: whole paragraphs from the start, up to
 * OPENING_WORDS words and never more. A first paragraph longer than that is
 * cut at a sentence (or a word). `continues` says the article goes on after
 * what is shown. Null when the body has fewer than MIN_PARAGRAPHS paragraphs.
 */
export function openingOf(content: unknown): {
  paragraphs: string[]
  continues: boolean
  totalWords: number
  shownWords: number
  /** The `bodyParagraphs` index where reading continues: the first
   * paragraph not shown, or the cut first paragraph itself. */
  nextParagraph: number
} | null {
  const all = bodyParagraphs(content)
  if (all.length < MIN_PARAGRAPHS) return null
  const total = all.reduce((sum, text) => sum + wordCount(text), 0)
  const paragraphs: string[] = []
  let words = 0
  for (const text of all) {
    const count = wordCount(text)
    if (words + count > OPENING_WORDS) break
    paragraphs.push(text)
    words += count
  }
  let nextParagraph = paragraphs.length
  if (paragraphs.length === 0) {
    const cut = cutToWords(all[0]!, OPENING_WORDS)
    paragraphs.push(cut)
    words = wordCount(cut.replace(/…$/u, ''))
    nextParagraph = 0
  }
  return {
    paragraphs,
    continues: words < total,
    totalWords: total,
    shownWords: words,
    nextParagraph,
  }
}

/**
 * Where "Read more" continues: the article view gives every body paragraph
 * `id="s-{p}-0"` in its server HTML, counting paragraphs exactly as
 * `bodyParagraphs` does (`readAnchor(p)` in lib/tiptap/readAnchors, pull
 * request 601). The anchor is positional, so it is built from the content
 * at the time of the read.
 */
export function readAnchor(paragraph: number): string {
  return `s-${paragraph}-0`
}

/** The first sentence of a paragraph, cut at a word near `max` characters. */
export function firstSentence(paragraph: string, max = 180): string {
  const sentence = paragraph.match(/^.+?[.!?…](?=\s|$)/u)?.[0] ?? paragraph
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The cleaned list of article ids to skip: strings only, short, at most EXCLUDE_LIMIT. */
export function cleanExclude(
  exclude: readonly string[] | undefined
): Set<string> {
  const ids = new Set<string>()
  for (const id of exclude ?? []) {
    if (ids.size === EXCLUDE_LIMIT) break
    if (typeof id === 'string' && /^[a-z0-9]{1,64}$/i.test(id)) ids.add(id)
  }
  return ids
}
