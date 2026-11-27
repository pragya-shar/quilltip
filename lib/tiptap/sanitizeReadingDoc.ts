/**
 * The article document as the reading view may render it: a fixed list of
 * nodes, marks and attributes, rebuilt from the author's JSON. Anything not
 * listed is dropped, so an author cannot add classes, styles, event
 * handlers, ids, link targets or unknown attributes to the page, whatever
 * the stored document holds. Attribute values are checked here and
 * escaped by the renderer; nothing edits rendered HTML afterwards.
 */
import type { JSONContent } from '@tiptap/core'

const ORIGIN = 'https://reading.invalid'
const MAX_TEXT_ATTR = 500
const MAX_DIMENSION = 10_000

/**
 * What the reading view will process of one document. Past any of these
 * the document is not rendered (`DocumentTooLarge`) and the page shows its
 * not-available state, so an oversized or deeply nested document can never
 * hold the server. A URL past its cap is dropped like an unsafe one.
 */
export const READING_LIMITS = {
  /** Nesting of nodes, the document's own level included. */
  depth: 24,
  /** Nodes of every kind, text included. */
  nodes: 20_000,
  /** Characters in one text node. */
  textLength: 50_000,
  /** Characters in a link or an image address. */
  urlLength: 2_048,
} as const

export class DocumentTooLarge extends Error {
  constructor(what: string) {
    super(`The article document is too large to render (${what})`)
  }
}

type Budget = { nodes: number }

/** Link targets a reader may follow: web pages, mail, and same-site paths. */
export function safeLinkHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > READING_LIMITS.urlLength)
    return null
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\'))
    return href
  if (href.startsWith('#')) return href
  try {
    const url = new URL(href, ORIGIN)
    if (url.origin === ORIGIN) return null
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
      ? url.href
      : null
  } catch {
    return null
  }
}

/** Image sources: web images and same-site paths, never data or script. */
export function safeImageSrc(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > READING_LIMITS.urlLength)
    return null
  const src = value.trim()
  if (!src || /[\u0000-\u001f\u007f\s]/.test(src)) return null
  if (src.startsWith('/') && !src.startsWith('//') && !src.startsWith('/\\'))
    return src
  try {
    const url = new URL(src)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null
  } catch {
    return null
  }
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
])

/** A YouTube address over https, or null. */
export function safeYoutubeSrc(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > READING_LIMITS.urlLength)
    return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && YOUTUBE_HOSTS.has(url.hostname)
      ? url.href
      : null
  } catch {
    return null
  }
}

const shortText = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.slice(0, MAX_TEXT_ATTR)
    : null
const dimension = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' &&
    Number.isInteger(n) &&
    n > 0 &&
    n <= MAX_DIMENSION
    ? n
    : null
}

const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code'])

function cleanMarks(marks: JSONContent['marks']): JSONContent['marks'] {
  const out: NonNullable<JSONContent['marks']> = []
  // A text node needs a handful of marks; more are dropped unread.
  for (const mark of (marks ?? []).slice(0, 8)) {
    if (SIMPLE_MARKS.has(mark.type)) out.push({ type: mark.type })
    else if (mark.type === 'link') {
      const href = safeLinkHref(mark.attrs?.href)
      if (href) out.push({ type: 'link', attrs: { href } })
    }
  }
  return out.length ? out : undefined
}

function cleanChildren(
  node: JSONContent,
  budget: Budget,
  depth: number,
  allowMarks = true
): JSONContent[] | undefined {
  if (!Array.isArray(node.content)) return undefined
  if (depth > READING_LIMITS.depth) throw new DocumentTooLarge('depth')
  const children = node.content
    .map((child) => cleanNode(child, budget, depth, allowMarks))
    .filter((child): child is JSONContent => child !== null)
  return children.length ? children : undefined
}

function cleanNode(
  node: JSONContent,
  budget: Budget,
  depth: number,
  allowMarks = true
): JSONContent | null {
  if (!node || typeof node !== 'object') return null
  if (++budget.nodes > READING_LIMITS.nodes) throw new DocumentTooLarge('nodes')
  const children = (n: JSONContent, marks = true) =>
    cleanChildren(n, budget, depth + 1, marks)
  switch (node.type) {
    case 'text': {
      if (typeof node.text !== 'string' || !node.text) return null
      if (node.text.length > READING_LIMITS.textLength)
        throw new DocumentTooLarge('text')
      const marks = allowMarks ? cleanMarks(node.marks) : undefined
      return marks
        ? { type: 'text', text: node.text, marks }
        : { type: 'text', text: node.text }
    }
    case 'paragraph':
    case 'blockquote':
    case 'bulletList':
    case 'listItem': {
      const content = children(node)
      return content ? { type: node.type, content } : { type: node.type }
    }
    case 'orderedList': {
      const start = dimension(node.attrs?.start)
      const content = children(node)
      return {
        type: 'orderedList',
        ...(start && start !== 1 ? { attrs: { start } } : {}),
        ...(content ? { content } : {}),
      }
    }
    case 'heading': {
      const asked = Number(node.attrs?.level)
      const level = asked >= 2 && asked <= 4 ? asked : asked > 4 ? 4 : 2
      const content = children(node)
      return {
        type: 'heading',
        attrs: { level },
        ...(content ? { content } : {}),
      }
    }
    case 'codeBlock': {
      const content = children(node, false)
      return content ? { type: 'codeBlock', content } : { type: 'codeBlock' }
    }
    case 'hardBreak':
    case 'horizontalRule':
      return { type: node.type }
    case 'image':
    case 'resizableImage': {
      const src = safeImageSrc(node.attrs?.src)
      if (!src) return null
      const attrs: Record<string, unknown> = { src }
      const alt = shortText(node.attrs?.alt)
      const title = shortText(node.attrs?.title)
      const width = dimension(node.attrs?.width)
      const height = dimension(node.attrs?.height)
      if (alt) attrs.alt = alt
      if (title) attrs.title = title
      if (width) attrs.width = width
      if (height) attrs.height = height
      return { type: 'resizableImage', attrs }
    }
    case 'youtube': {
      const src = safeYoutubeSrc(node.attrs?.src)
      return src ? { type: 'youtube', attrs: { src } } : null
    }
    default:
      return null
  }
}

/** The author's document, reduced to what the reading view renders. */
export function sanitizeReadingDoc(content: JSONContent): JSONContent {
  const budget: Budget = { nodes: 0 }
  const blocks = Array.isArray(content?.content) ? content.content : []
  const children = blocks
    .map((child) => cleanNode(child, budget, 2))
    .filter((child): child is JSONContent => child !== null)
  return { type: 'doc', content: children }
}
