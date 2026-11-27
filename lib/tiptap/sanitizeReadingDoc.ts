/**
 * The article document as the reading view may render it: a fixed list of
 * nodes, marks and attributes, rebuilt from the author's JSON. Anything not
 * listed is dropped, so an author cannot add classes, styles, event
 * handlers, ids, link targets or unknown attributes to the page, whatever
 * the stored document holds. Each parent takes only the children listed for
 * it, and every value is checked before it is copied. The renderer then
 * validates the result against the reading schema and escapes it; nothing
 * edits rendered HTML afterwards.
 */
import type { JSONContent } from '@tiptap/core'

/** A placeholder origin that resolves same-site paths; never served. */
const ORIGIN = 'https://reading.invalid'
const MAX_TEXT_ATTR = 500
const MAX_DIMENSION = 10_000
/** Marks read on one text node; a text node needs a handful. */
const MAX_MARKS = 8

/**
 * What the reading view will process of one document. Past any of these
 * the document is not rendered (`DocumentTooLarge`) and the page shows its
 * not-available state, so an oversized or deeply nested document can never
 * hold the server. A URL past its cap is dropped like an unsafe one.
 */
export const READING_LIMITS = {
  /** Nesting of nodes, the document's own level included. */
  depth: 24,
  /** Entries of every kind in every content list, text included. */
  nodes: 20_000,
  /** Characters in one text node. */
  textLength: 50_000,
  /** Characters in a link or an image address. */
  urlLength: 2_048,
  /** Video embeds. */
  embeds: 20,
  /** Images. */
  images: 200,
} as const

export class DocumentTooLarge extends Error {
  constructor(what: string) {
    super(`The article document is too large to render (${what})`)
  }
}

/** Where the reading view may load article images from. */
export type ReadingSources = {
  /**
   * The origin of this deployment's file storage (`https://<name>.convex.cloud`),
   * or null when none is configured. Only its exact origin is accepted.
   */
  storageOrigin: string | null
}

/** This deployment's file storage: the origin of its Convex URL. */
export function deploymentSources(): ReadingSources {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? '')
    return {
      storageOrigin:
        url.protocol === 'https:' || url.protocol === 'http:'
          ? url.origin
          : null,
    }
  } catch {
    return { storageOrigin: null }
  }
}

/** Same-site paths that hold the site's own images. */
const SITE_IMAGE_PATHS = ['/images/']
/** Paths of uploaded files on the storage origin. */
const STORAGE_PATH = '/api/storage/'

/** Controls, spaces and backslashes: refused in any address before parsing. */
const UNSAFE_IN_URL = /[\\\s\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/
/** Bidirectional controls, stripped from link text. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The trimmed address when it is a string within the caps, or null. */
function address(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > READING_LIMITS.urlLength)
    return null
  const url = value.trim()
  return url && !UNSAFE_IN_URL.test(url) ? url : null
}

/** The address parsed against the placeholder origin, or null. */
function parse(value: string): URL | null {
  try {
    return new URL(value, ORIGIN)
  } catch {
    return null
  }
}

const MAIL_ADDRESS =
  /^[A-Za-z0-9.!#$&'*+/=^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

/**
 * Link targets a reader may follow: web pages without credentials, one mail
 * address, and same-site paths. Same-site is decided by parsing, and the
 * normalised path is what the page links to.
 */
export function safeLinkHref(value: unknown): string | null {
  const href = address(value)
  if (!href) return null
  if (/^#[\w-]+$/.test(href)) return href
  const url = parse(href)
  if (!url) return null
  if (href.startsWith('/')) {
    // `//host` parses to another origin and is refused here.
    return url.origin === ORIGIN ? url.pathname + url.search + url.hash : null
  }
  // A relative path, or the placeholder origin itself, is not a link.
  if (url.origin === ORIGIN) return null
  if (url.protocol === 'mailto:')
    return MAIL_ADDRESS.test(url.pathname) ? `mailto:${url.pathname}` : null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  return url.href
}

/**
 * Image sources: the site's own image paths, or an upload on this
 * deployment's file storage. The query and fragment are dropped. Every
 * other host, and data or script addresses, are refused.
 */
export function safeImageSrc(
  value: unknown,
  sources: ReadingSources
): string | null {
  const src = address(value)
  if (!src) return null
  const url = parse(src)
  if (!url || url.username || url.password) return null
  if (url.origin === ORIGIN)
    return src.startsWith('/') &&
      SITE_IMAGE_PATHS.some((path) => url.pathname.startsWith(path))
      ? url.pathname
      : null
  // Written in full: a protocol-relative address is refused.
  return sources.storageOrigin !== null &&
    src.startsWith(`${sources.storageOrigin}/`) &&
    url.origin === sources.storageOrigin &&
    url.pathname.startsWith(STORAGE_PATH)
    ? url.origin + url.pathname
    : null
}

/** The only embed address the reading view renders. */
export const YOUTUBE_EMBED =
  /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}$/

const YOUTUBE_ID = /^[\w-]{11}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/** The video id in a YouTube address of a known form, or null. */
export function youtubeId(value: unknown): string | null {
  const src = address(value)
  if (!src) return null
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null
  const [first = '', second, ...rest] = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  if (rest.length) return null
  if (url.hostname === 'youtu.be') {
    if (second === undefined) id = first
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (first === 'watch' && second === undefined)
      id = url.searchParams.get('v')
    else if (
      second !== undefined &&
      ['embed', 'shorts', 'live'].includes(first)
    )
      id = second
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

/** The embed address rebuilt from the video id: nothing else is kept. */
export function safeYoutubeSrc(value: unknown): string | null {
  const id = youtubeId(value)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}

const shortText = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.slice(0, MAX_TEXT_ATTR)
    : null

/** A whole number from 1 to 10,000, written as a number or as digits. */
const dimension = (value: unknown) => {
  const n =
    typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value
  return typeof n === 'number' &&
    Number.isInteger(n) &&
    n > 0 &&
    n <= MAX_DIMENSION
    ? n
    : null
}

const HEADING_LEVELS = [2, 3, 4]
const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike'])

type Mark = NonNullable<JSONContent['marks']>[number]

/**
 * The marks of one text node: known types once each, a checked link, and
 * code alone (it excludes every other mark). Malformed marks are dropped.
 */
function cleanMarks(marks: unknown): Mark[] | undefined {
  if (!Array.isArray(marks)) return undefined
  const kept = new Map<string, Mark>()
  for (const mark of marks.slice(0, MAX_MARKS)) {
    if (!isRecord(mark) || typeof mark.type !== 'string') continue
    const type = mark.type
    if (kept.has(type)) continue
    if (SIMPLE_MARKS.has(type) || type === 'code') kept.set(type, { type })
    else if (type === 'link' && isRecord(mark.attrs)) {
      const href = safeLinkHref(mark.attrs.href)
      if (href) kept.set(type, { type, attrs: { href } })
    }
  }
  if (kept.has('code')) return [{ type: 'code' }]
  return kept.size ? [...kept.values()] : undefined
}

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'image',
  'resizableImage',
  'youtube',
])
const INLINE = new Set(['text', 'hardBreak'])
const LIST_ITEMS = new Set(['listItem'])

/** The children each parent may hold; any other child is dropped. */
const CHILDREN: Record<string, ReadonlySet<string>> = {
  doc: BLOCKS,
  blockquote: BLOCKS,
  listItem: BLOCKS,
  bulletList: LIST_ITEMS,
  orderedList: LIST_ITEMS,
  paragraph: INLINE,
  heading: INLINE,
  codeBlock: new Set(['text']),
}

type Walk = {
  sources: ReadingSources
  nodes: number
  embeds: number
  images: number
  /** Images kept so far. */
  shown: number
}

function cleanChildren(
  parent: string,
  content: unknown,
  walk: Walk,
  depth: number
): JSONContent[] {
  if (!Array.isArray(content)) return []
  if (depth > READING_LIMITS.depth) throw new DocumentTooLarge('depth')
  const allowed = CHILDREN[parent]
  const out: JSONContent[] = []
  for (let i = 0; i < content.length; i++) {
    // Every entry counts, whatever it holds.
    if (++walk.nodes > READING_LIMITS.nodes) throw new DocumentTooLarge('nodes')
    const child: unknown = content[i]
    if (!isRecord(child) || typeof child.type !== 'string') continue
    if (!allowed?.has(child.type)) continue
    const clean = cleanNode(parent, child, walk, depth)
    if (clean) out.push(clean)
  }
  return out
}

function cleanNode(
  parent: string,
  node: Record<string, unknown>,
  walk: Walk,
  depth: number
): JSONContent | null {
  const attrs = isRecord(node.attrs) ? node.attrs : {}
  const children = (type: string) =>
    cleanChildren(type, node.content, walk, depth + 1)
  switch (node.type) {
    case 'text': {
      if (typeof node.text !== 'string') return null
      if (node.text.length > READING_LIMITS.textLength)
        throw new DocumentTooLarge('text')
      // Code blocks hold plain text.
      const marks = parent === 'codeBlock' ? undefined : cleanMarks(node.marks)
      const linked = marks?.some((mark) => mark.type === 'link')
      const text = linked ? node.text.replace(BIDI_CONTROLS, '') : node.text
      if (!text) return null
      return marks ? { type: 'text', text, marks } : { type: 'text', text }
    }
    case 'paragraph':
    case 'codeBlock': {
      const content = children(node.type)
      return content.length ? { type: node.type, content } : { type: node.type }
    }
    case 'heading': {
      const level = HEADING_LEVELS.includes(attrs.level as number)
        ? (attrs.level as number)
        : 2
      const content = children('heading')
      return {
        type: 'heading',
        attrs: { level },
        ...(content.length ? { content } : {}),
      }
    }
    case 'blockquote':
    case 'bulletList': {
      // An empty quote or list is not valid; it is dropped.
      const content = children(node.type)
      return content.length ? { type: node.type, content } : null
    }
    case 'orderedList': {
      const content = children('orderedList')
      if (!content.length) return null
      const start = dimension(attrs.start)
      return {
        type: 'orderedList',
        ...(start && start !== 1 ? { attrs: { start } } : {}),
        content,
      }
    }
    case 'listItem': {
      // A list item opens with a paragraph.
      const content = children('listItem')
      if (content[0]?.type !== 'paragraph')
        content.unshift({ type: 'paragraph' })
      return { type: 'listItem', content }
    }
    case 'hardBreak':
    case 'horizontalRule':
      return { type: node.type }
    case 'image':
    case 'resizableImage': {
      if (++walk.images > READING_LIMITS.images)
        throw new DocumentTooLarge('images')
      const src = safeImageSrc(attrs.src, walk.sources)
      if (!src) return null
      const image: Record<string, unknown> = { src }
      const alt = shortText(attrs.alt)
      const title = shortText(attrs.title)
      const width = dimension(attrs.width)
      const height = dimension(attrs.height)
      if (alt) image.alt = alt
      if (title) image.title = title
      if (width) image.width = width
      if (height) image.height = height
      // The first image may be the largest paint; the rest wait.
      if (++walk.shown > 1) image.loading = 'lazy'
      return { type: 'resizableImage', attrs: image }
    }
    case 'youtube': {
      if (++walk.embeds > READING_LIMITS.embeds)
        throw new DocumentTooLarge('embeds')
      const src = safeYoutubeSrc(attrs.src)
      return src ? { type: 'youtube', attrs: { src } } : null
    }
    default:
      return null
  }
}

/** The author's document, reduced to what the reading view renders. */
export function sanitizeReadingDoc(
  content: JSONContent,
  sources: ReadingSources
): JSONContent {
  const walk: Walk = { sources, nodes: 0, embeds: 0, images: 0, shown: 0 }
  const root: unknown = content
  const blocks = isRecord(root) ? root.content : undefined
  return { type: 'doc', content: cleanChildren('doc', blocks, walk, 2) }
}
