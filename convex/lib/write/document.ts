/**
 * Checks on a draft's TipTap document for the Write backend (`convex/write.ts`).
 *
 * - Size: a document whose JSON is over `MAX_DOCUMENT_JSON_BYTES` (UTF-8) is
 *   refused on save and on publish.
 * - Readability (publish): the stored document must come out of the reading
 *   sanitiser unchanged, so what is published is exactly what readers get.
 *   The sanitiser is passed in (`READING_SANITIZER` by default). Until the
 *   reading sanitiser is in this tree, the default is null and only the size
 *   is checked; wiring it is one line here.
 */
import { articleReadingText, countWords } from '../../../lib/reading-time'

export const MAX_DOCUMENT_JSON_BYTES = 800 * 1024
/** Longest first line shown on the desk. */
export const FIRST_LINE_MAX = 200

/**
 * Returns the reading form of a document, or throws an error named
 * `DocumentTooLarge` when the document is past the reading limits.
 */
export type ReadingSanitizer = (content: unknown) => unknown

/**
 * The reading sanitiser (`sanitizeReadingDoc` from `lib/tiptap`), wired here
 * once it is in this tree. Null: only the size is checked.
 */
export const READING_SANITIZER: ReadingSanitizer | null = null

export type ReadingCheck =
  | { ok: true }
  | { ok: false; code: 'document-too-large' | 'document-not-readable' }

export function documentJsonBytes(content: unknown): number {
  return new TextEncoder().encode(JSON.stringify(content ?? null)).length
}

export function isDocumentTooLarge(content: unknown): boolean {
  return documentJsonBytes(content) > MAX_DOCUMENT_JSON_BYTES
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return (
      a.length === other.length && a.every((x, i) => deepEqual(x, other[i]))
    )
  }
  const ka = Object.keys(a as object).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined
  )
  const kb = Object.keys(b as object).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined
  )
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k]
    )
  )
}

/** Whether a document may be published as stored. */
export function checkReadingDocument(
  content: unknown,
  sanitize: ReadingSanitizer | null = READING_SANITIZER
): ReadingCheck {
  if (isDocumentTooLarge(content)) {
    return { ok: false, code: 'document-too-large' }
  }
  if (!sanitize) return { ok: true }
  let reading: unknown
  try {
    reading = sanitize(content)
  } catch (error) {
    if (error instanceof Error && error.name === 'DocumentTooLarge') {
      return { ok: false, code: 'document-too-large' }
    }
    throw error
  }
  return deepEqual(reading, content)
    ? { ok: true }
    : { ok: false, code: 'document-not-readable' }
}

/** Whether a sanitiser refuses a document as too large (for saving). */
export function sanitizerFindsTooLarge(
  content: unknown,
  sanitize: ReadingSanitizer | null = READING_SANITIZER
): boolean {
  if (!sanitize) return false
  try {
    sanitize(content)
    return false
  } catch (error) {
    return error instanceof Error && error.name === 'DocumentTooLarge'
  }
}

function paragraphText(node: Record<string, unknown>): string {
  const parts: string[] = []
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const r = n as Record<string, unknown>
    if (r.type === 'text' && typeof r.text === 'string') parts.push(r.text)
    else if (r.type === 'hardBreak') parts.push(' ')
    else if (Array.isArray(r.content)) r.content.forEach(visit)
  }
  visit(node)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * The text of the first non-empty paragraph, cut at `FIRST_LINE_MAX`
 * characters on a word.
 */
export function firstLineOf(content: unknown): string {
  let found = ''
  const visit = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false
    const r = n as Record<string, unknown>
    if (r.type === 'paragraph') {
      found = paragraphText(r)
      return found.length > 0
    }
    return Array.isArray(r.content) && r.content.some(visit)
  }
  visit(content)
  if (found.length <= FIRST_LINE_MAX) return found
  const cut = found.slice(0, FIRST_LINE_MAX + 1)
  const space = cut.lastIndexOf(' ')
  return (
    space > 0 ? cut.slice(0, space) : cut.slice(0, FIRST_LINE_MAX)
  ).trimEnd()
}

/** Words, counted as the reading time counts them. */
export function wordsOf(content: unknown): number {
  return countWords(articleReadingText(content))
}
