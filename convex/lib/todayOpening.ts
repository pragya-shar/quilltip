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

/** Six hours: the opening changes four times a day (00, 06, 12, 18 UTC). */
export const WINDOW_MS = 6 * 60 * 60 * 1000

/** Newest published articles read per call: one indexed read, bounded. */
export const CANDIDATE_READ_LIMIT = 60

/** Articles a reader finished that the caller may ask to skip. */
export const EXCLUDE_LIMIT = 20

/** "More to read" after the opening: a short list that ends. */
export const MORE_LIMIT = 4

/** An article shorter than this is not "underway" enough to open Today. */
export const MIN_BODY_WORDS = 60

/** The opening shows at most this many paragraphs, and stops near this many words. */
export const OPENING_PARAGRAPHS = 3
export const OPENING_WORDS = 170

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

/** Words in an article's body paragraphs (what `openingOf` counts). */
export function bodyWords(content: unknown): number {
  return bodyParagraphs(content).reduce((sum, text) => sum + wordCount(text), 0)
}

/**
 * Minutes left to read, as a pure function of the article's length and the
 * reader's position: the article's reading time, less the share of its words
 * already read, rounded up. Zero once nothing is left. Used for the opening
 * ("4 min left" after the shown paragraphs); a server-side reading position
 * can call it with the words read so far.
 */
export function minutesLeft({
  readMinutes,
  totalWords,
  wordsRead,
}: {
  readMinutes: number
  totalWords: number
  wordsRead: number
}): number {
  if (totalWords <= 0 || wordsRead >= totalWords) return 0
  const share = 1 - Math.max(wordsRead, 0) / totalWords
  return Math.max(1, Math.ceil(readMinutes * share))
}

/**
 * The first paragraphs of an article, whole: at most OPENING_PARAGRAPHS,
 * stopping once OPENING_WORDS are reached. `continues` says the article has
 * more after them. Null when the body is too short to open Today.
 */
export function openingOf(content: unknown): {
  paragraphs: string[]
  continues: boolean
  totalWords: number
  shownWords: number
} | null {
  const all = bodyParagraphs(content)
  const total = all.reduce((sum, text) => sum + wordCount(text), 0)
  if (total < MIN_BODY_WORDS) return null
  const paragraphs: string[] = []
  let words = 0
  for (const text of all) {
    if (paragraphs.length === OPENING_PARAGRAPHS || words >= OPENING_WORDS)
      break
    paragraphs.push(text)
    words += wordCount(text)
  }
  return {
    paragraphs,
    continues: paragraphs.length < all.length,
    totalWords: total,
    shownWords: words,
  }
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
