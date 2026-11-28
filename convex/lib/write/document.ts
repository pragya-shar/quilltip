/**
 * Checks on a draft's TipTap document for the Write backend (`convex/write.ts`).
 *
 * - Size: a document whose JSON is over `MAX_DOCUMENT_JSON_BYTES` (UTF-8) is
 *   refused on save and on publish.
 * - Readability (publish): once wired, the stored document must come out of
 *   the reading sanitiser unchanged, so what is published is exactly what
 *   readers get. The sanitiser is passed in (`READING_SANITIZER` by default).
 *   `READING_SANITIZER` is null until the article view's sanitiser is in this
 *   tree, so today only the size is checked and `document-not-readable`
 *   never fires; wiring it is one line here.
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

/**
 * The deepest `content` value the backend stores. A Convex document nests at
 * most 16 levels (measured on a local backend: "Document is too nested
 * (nested 18 levels deep > maximum nesting 16)"), and the article row is one
 * of them. An object or an array is one level, so each TipTap node level is
 * two (the node and its `content` array). In node levels, counting the doc
 * and the deepest node: 8 when the deepest node is plain text, 7 when it is
 * a node with `attrs` (an image), 6 when it is text with a mark that has
 * `attrs` (a link).
 */
export const MAX_CONTENT_VALUE_DEPTH = 15

/** The most items one array in a stored value may hold (a platform limit). */
export const MAX_ARRAY_ITEMS = 8192

/** Why a document cannot be stored, or null. */
export type DocumentShapeProblem =
  | { code: 'document-too-nested'; maxValueDepth: number }
  | {
      code: 'document-invalid'
      reason: 'not-a-doc' | 'value' | 'key' | 'array-too-long'
      maxItems?: number
    }

/**
 * Checks that `content` is a document the backend stores as given: a plain
 * object with `type: 'doc'`, holding only strings, numbers, booleans, null,
 * plain objects and arrays (no BigInt, no bytes, no key starting with `$` or
 * `_`), no array over `MAX_ARRAY_ITEMS` items and no nesting past
 * `MAX_CONTENT_VALUE_DEPTH`. Walks without recursion and stops at the first
 * problem.
 */
export function documentShapeProblem(
  content: unknown
): DocumentShapeProblem | null {
  if (
    content === null ||
    typeof content !== 'object' ||
    Array.isArray(content) ||
    content instanceof ArrayBuffer ||
    ArrayBuffer.isView(content) ||
    (content as { type?: unknown }).type !== 'doc'
  ) {
    return { code: 'document-invalid', reason: 'not-a-doc' }
  }
  const stack: Array<[unknown, number]> = [[content, 1]]
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!
    const kind = typeof value
    if (kind === 'bigint' || kind === 'function' || kind === 'symbol') {
      return { code: 'document-invalid', reason: 'value' }
    }
    if (value === null || kind !== 'object') continue
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return { code: 'document-invalid', reason: 'value' }
    }
    if (depth > MAX_CONTENT_VALUE_DEPTH) {
      return {
        code: 'document-too-nested',
        maxValueDepth: MAX_CONTENT_VALUE_DEPTH,
      }
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        return {
          code: 'document-invalid',
          reason: 'array-too-long',
          maxItems: MAX_ARRAY_ITEMS,
        }
      }
      for (const child of value) stack.push([child, depth + 1])
      continue
    }
    for (const [key, child] of Object.entries(value as object)) {
      if (key.startsWith('$') || key.startsWith('_')) {
        return { code: 'document-invalid', reason: 'key' }
      }
      stack.push([child, depth + 1])
    }
  }
  return null
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
