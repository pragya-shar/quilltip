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

// --- The allowlist, as data ------------------------------------------
//
// One definition of what an article may hold. The sanitiser walks these
// tables, and the editor builds its schema from them, so what a writer can
// make and what a reader is shown are the same set.

/** Block nodes: the children of the document, a quote and a list item. */
export const READING_BLOCKS = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'resizableImage',
  'youtube',
] as const
/** Inline nodes: the children of a paragraph and a heading. */
export const READING_INLINE = ['text', 'hardBreak'] as const

export type ReadingNodeName =
  | 'doc'
  | 'listItem'
  | (typeof READING_BLOCKS)[number]
  | (typeof READING_INLINE)[number]

export type ReadingNodeRule = {
  /** The node types it may hold, in any order; any other child is dropped. */
  children: readonly ReadingNodeName[]
  /** The attributes an author may set; every other attribute is dropped. */
  attrs: readonly string[]
  /** Whether its text may carry marks. */
  marks: boolean
}

const leaf = (attrs: readonly string[] = []): ReadingNodeRule => ({
  children: [],
  attrs,
  marks: false,
})

/** Every node the reading view renders, with its children and attributes. */
export const READING_NODES: Readonly<Record<ReadingNodeName, ReadingNodeRule>> =
  {
    doc: { children: READING_BLOCKS, attrs: [], marks: false },
    paragraph: { children: READING_INLINE, attrs: [], marks: true },
    heading: { children: READING_INLINE, attrs: ['level'], marks: true },
    blockquote: { children: READING_BLOCKS, attrs: [], marks: false },
    bulletList: { children: ['listItem'], attrs: [], marks: false },
    orderedList: { children: ['listItem'], attrs: ['start'], marks: false },
    // A list item opens with a paragraph; the sanitiser adds one if not.
    listItem: { children: READING_BLOCKS, attrs: [], marks: false },
    codeBlock: { children: ['text'], attrs: [], marks: false },
    text: leaf(),
    hardBreak: leaf(),
    horizontalRule: leaf(),
    resizableImage: leaf(['src', 'alt', 'title', 'width', 'height']),
    youtube: leaf(['src']),
  }

/** Older names read as a listed node: the editor's plain image. */
export const READING_NODE_ALIASES: Readonly<Record<string, ReadingNodeName>> = {
  image: 'resizableImage',
}

/**
 * Attributes the reading renderer sets itself, never from the author:
 * the anchors of `readAnchors.ts` and the lazy loading of later images.
 */
export const READING_DERIVED_ATTRS: Readonly<
  Partial<Record<ReadingNodeName, readonly string[]>>
> = { paragraph: ['anchor'], heading: ['anchor'], resizableImage: ['loading'] }

export type ReadingMarkName =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'

/** Every mark, with its attributes. `code` excludes every other mark. */
export const READING_MARKS: Readonly<
  Record<ReadingMarkName, { attrs: readonly string[]; excludesOthers: boolean }>
> = {
  bold: { attrs: [], excludesOthers: false },
  italic: { attrs: [], excludesOthers: false },
  underline: { attrs: [], excludesOthers: false },
  strike: { attrs: [], excludesOthers: false },
  code: { attrs: [], excludesOthers: true },
  link: { attrs: ['href'], excludesOthers: false },
}

/** Heading levels kept; any other level reads as the first. */
export const READING_HEADING_LEVELS = [2, 3, 4] as const

const isNodeName = (type: string): type is ReadingNodeName =>
  Object.hasOwn(READING_NODES, type)
const isMarkName = (type: string): type is ReadingMarkName =>
  Object.hasOwn(READING_MARKS, type)

type Check = (value: unknown, walk: Walk) => unknown

/**
 * The value check of every listed attribute: a checked value, or null to
 * drop the attribute. A node whose `required` attribute fails is dropped.
 */
export const READING_ATTR_CHECKS: Readonly<
  Partial<Record<ReadingNodeName | ReadingMarkName, Record<string, Check>>>
> = {
  heading: {
    level: (value) =>
      READING_HEADING_LEVELS.includes(value as 2)
        ? value
        : READING_HEADING_LEVELS[0],
  },
  orderedList: {
    start: (value) => {
      const start = dimension(value)
      return start && start !== 1 ? start : null
    },
  },
  resizableImage: {
    src: (value, walk) => safeImageSrc(value, walk.sources),
    alt: shortText,
    title: shortText,
    width: dimension,
    height: dimension,
  },
  youtube: { src: (value) => safeYoutubeSrc(value) },
  link: { href: (value) => safeLinkHref(value) },
}
const REQUIRED: Readonly<Record<string, string>> = {
  resizableImage: 'src',
  youtube: 'src',
  link: 'href',
}

/** The listed attributes of `type`, checked; null when a required one fails. */
function cleanAttrs(
  type: ReadingNodeName | ReadingMarkName,
  names: readonly string[],
  given: unknown,
  walk: Walk
): Record<string, unknown> | null {
  const attrs = isRecord(given) ? given : {}
  const checks = READING_ATTR_CHECKS[type] ?? {}
  const out: Record<string, unknown> = {}
  for (const name of names) {
    const value = checks[name]?.(attrs[name], walk) ?? null
    if (value !== null) out[name] = value
    else if (REQUIRED[type] === name) return null
  }
  return out
}

type Mark = NonNullable<JSONContent['marks']>[number]

/**
 * The marks of one text node: listed types once each, with checked
 * attributes, and an excluding mark alone. Malformed marks are dropped.
 */
function cleanMarks(marks: unknown, walk: Walk): Mark[] | undefined {
  if (!Array.isArray(marks)) return undefined
  const kept = new Map<ReadingMarkName, Mark>()
  for (const mark of marks.slice(0, MAX_MARKS)) {
    if (!isRecord(mark) || typeof mark.type !== 'string') continue
    const type = mark.type
    if (!isMarkName(type) || kept.has(type)) continue
    const names = READING_MARKS[type].attrs
    const attrs = cleanAttrs(type, names, mark.attrs, walk)
    if (!attrs) continue
    kept.set(type, names.length ? { type, attrs } : { type })
  }
  for (const [type, mark] of kept)
    if (READING_MARKS[type].excludesOthers) return [mark]
  return kept.size ? [...kept.values()] : undefined
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
  parent: ReadingNodeName,
  content: unknown,
  walk: Walk,
  depth: number
): JSONContent[] {
  if (!Array.isArray(content)) return []
  if (depth > READING_LIMITS.depth) throw new DocumentTooLarge('depth')
  const allowed: readonly string[] = READING_NODES[parent].children
  const out: JSONContent[] = []
  for (let i = 0; i < content.length; i++) {
    // Every entry counts, whatever it holds.
    if (++walk.nodes > READING_LIMITS.nodes) throw new DocumentTooLarge('nodes')
    const child: unknown = content[i]
    if (!isRecord(child) || typeof child.type !== 'string') continue
    const type = Object.hasOwn(READING_NODE_ALIASES, child.type)
      ? READING_NODE_ALIASES[child.type]!
      : child.type
    if (!isNodeName(type) || !allowed.includes(type)) continue
    const clean = cleanNode(parent, type, child, walk, depth)
    if (clean) out.push(clean)
  }
  return out
}

function cleanNode(
  parent: ReadingNodeName,
  type: ReadingNodeName,
  node: Record<string, unknown>,
  walk: Walk,
  depth: number
): JSONContent | null {
  if (type === 'text') {
    if (typeof node.text !== 'string') return null
    if (node.text.length > READING_LIMITS.textLength)
      throw new DocumentTooLarge('text')
    const marks = READING_NODES[parent].marks
      ? cleanMarks(node.marks, walk)
      : undefined
    const linked = marks?.some((mark) => mark.type === 'link')
    const text = linked ? node.text.replace(BIDI_CONTROLS, '') : node.text
    if (!text) return null
    return marks ? { type, text, marks } : { type, text }
  }
  if (type === 'resizableImage' && ++walk.images > READING_LIMITS.images)
    throw new DocumentTooLarge('images')
  if (type === 'youtube' && ++walk.embeds > READING_LIMITS.embeds)
    throw new DocumentTooLarge('embeds')

  const rule = READING_NODES[type]
  const attrs = cleanAttrs(type, rule.attrs, node.attrs, walk)
  if (!attrs) return null
  // The first image may be the largest paint; the rest wait.
  if (type === 'resizableImage' && ++walk.shown > 1) attrs.loading = 'lazy'
  const content = rule.children.length
    ? cleanChildren(type, node.content, walk, depth + 1)
    : []
  // An empty quote or list is not valid; it is dropped.
  if (
    (type === 'blockquote' ||
      type === 'bulletList' ||
      type === 'orderedList') &&
    !content.length
  )
    return null
  // A list item opens with a paragraph.
  if (type === 'listItem' && content[0]?.type !== 'paragraph')
    content.unshift({ type: 'paragraph' })
  return {
    type,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
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
