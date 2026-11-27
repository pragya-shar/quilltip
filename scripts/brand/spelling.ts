/**
 * The product name is written "Quilltip": one capital letter, also at the
 * start of a sentence, in headings and in possessives. This module finds the
 * old spellings and rewrites them, except where the allowlist keeps them
 * (stored or signed data, files owned elsewhere, drawn assets).
 *
 * Pure functions over file text. `apply-spelling.ts` walks the repository.
 * The result depends only on the file text, its path and the allowlist, so
 * every branch that runs the script gets the same result.
 */

/**
 * Old spelling to new spelling. Case-sensitive; no two rules can match the
 * same text, so the order does not matter.
 */
export const RULES: ReadonlyArray<{ pattern: RegExp; to: string }> = [
  { pattern: /QuillTip/g, to: 'Quilltip' },
  { pattern: /Quill Tip/g, to: 'Quilltip' },
  // The wordmark draws the Q as the logo and writes the rest as text, which
  // may sit on its own line: `<svg>…</svg><span>uillTip</span>`.
  { pattern: /(?<!Q)uillTip/g, to: 'uilltip' },
]

/**
 * Characters a `match` needs beyond the old spelling it keeps, so an entry
 * names one piece of text instead of every occurrence on a path.
 */
export const MIN_MATCH_CONTEXT = 4

/** Every rule match in `line`: start index and matched text. */
function ruleMatches(line: string) {
  const found: { at: number; from: string; to: string }[] = []
  for (const rule of RULES)
    for (const m of line.matchAll(rule.pattern))
      found.push({ at: m.index, from: m[0], to: rule.to })
  return found.sort((a, b) => a.at - b.at)
}

/**
 * Why an occurrence is kept.
 * - B: a code identifier that generated code or another package depends on.
 * - C: stored or signed data.
 * - D: not ours to change here (contracts, generated bindings, the v2
 *   specification, the repository path).
 * - E: an image or other drawn asset; listed for the record, never scanned.
 * - tool: this tool's own rules and tests.
 */
export const ALLOW_CLASSES = ['B', 'C', 'D', 'E', 'tool'] as const
export type AllowClass = (typeof ALLOW_CLASSES)[number]

export type AllowEntry = {
  class: AllowClass
  /**
   * A repository-relative file, or a directory ending in "/". Omitted: every
   * path.
   */
  path?: string
  /**
   * Literal text on the same line that contains the occurrence. Omitted: every
   * occurrence in `path`.
   */
  match?: string
  reason: string
}

export type Occurrence = {
  path: string
  /** 1-based. */
  line: number
  /** 1-based, in UTF-16 code units. */
  column: number
  from: string
  to: string
  /** The entry that keeps it, if any. */
  keptBy?: AllowEntry
  /** The text of the line, before any change. */
  text: string
}

export function validateAllowlist(value: unknown): AllowEntry[] {
  if (!Array.isArray(value)) throw new Error('The allowlist must be an array.')
  return value.map((raw, index) => {
    const where = `Allowlist entry ${index + 1}`
    if (typeof raw !== 'object' || raw === null)
      throw new Error(`${where} must be an object.`)
    const entry = raw as Record<string, unknown>
    if (!ALLOW_CLASSES.includes(entry.class as AllowClass))
      throw new Error(`${where} needs a class: ${ALLOW_CLASSES.join(', ')}.`)
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10)
      throw new Error(`${where} needs a reason.`)
    if (
      entry.path !== undefined &&
      (typeof entry.path !== 'string' || !entry.path)
    )
      throw new Error(`${where} has an empty path.`)
    if (entry.path?.toString().startsWith('/'))
      throw new Error(`${where}: the path must be relative to the repository.`)
    if (
      entry.match !== undefined &&
      (typeof entry.match !== 'string' || !entry.match)
    )
      throw new Error(`${where} has an empty match.`)
    if (entry.path === undefined && entry.match === undefined)
      throw new Error(`${where} needs a path, a match or both.`)
    if (typeof entry.match === 'string') {
      // A match must name the kept text, not only the old spelling, so an
      // entry cannot keep every occurrence on a path.
      const inside = ruleMatches(entry.match)
      if (inside.length === 0)
        throw new Error(`${where}: the match contains no old spelling.`)
      const text = entry.match
      if (inside.some((m) => text.length < m.from.length + MIN_MATCH_CONTEXT))
        throw new Error(
          `${where}: the match must contain more than the old spelling ` +
            `(at least ${MIN_MATCH_CONTEXT} more characters of the kept text).`
        )
    }
    const known = new Set(['class', 'path', 'match', 'reason'])
    for (const key of Object.keys(entry))
      if (!known.has(key))
        throw new Error(`${where} has an unknown key "${key}".`)
    return entry as AllowEntry
  })
}

export function pathMatches(entry: AllowEntry, path: string): boolean {
  if (entry.path === undefined) return true
  return entry.path.endsWith('/')
    ? path.startsWith(entry.path)
    : path === entry.path
}

/** True when the path is excluded as a whole (no `match`). */
export function isPathExcluded(path: string, allowlist: AllowEntry[]): boolean {
  return allowlist.some((e) => e.match === undefined && pathMatches(e, path))
}

function keeper(
  path: string,
  line: string,
  start: number,
  length: number,
  allowlist: AllowEntry[]
): AllowEntry | undefined {
  for (const entry of allowlist) {
    if (!pathMatches(entry, path)) continue
    if (entry.match === undefined) return entry
    let at = line.indexOf(entry.match)
    while (at !== -1) {
      if (at <= start && start + length <= at + entry.match.length) return entry
      at = line.indexOf(entry.match, at + 1)
    }
  }
  return undefined
}

/** Every old spelling in `text`, kept or not, in reading order. */
export function findOccurrences(
  path: string,
  text: string,
  allowlist: AllowEntry[]
): Occurrence[] {
  const found: Occurrence[] = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    for (const m of ruleMatches(line))
      found.push({
        path,
        line: index + 1,
        column: m.at + 1,
        from: m.from,
        to: m.to,
        keptBy: keeper(path, line, m.at, m.from.length, allowlist),
        text: line,
      })
  })
  return found
}

/** The text with every old spelling that is not kept rewritten. */
export function applySpelling(
  path: string,
  text: string,
  allowlist: AllowEntry[]
): { text: string; changed: Occurrence[]; kept: Occurrence[] } {
  const all = findOccurrences(path, text, allowlist)
  const changed = all.filter((o) => !o.keptBy)
  const kept = all.filter((o) => o.keptBy)
  if (changed.length === 0) return { text, changed, kept }
  const lines = text.split('\n')
  // Right to left on each line, so earlier columns stay valid.
  for (const o of [...changed].reverse()) {
    const line = lines[o.line - 1]!
    const start = o.column - 1
    lines[o.line - 1] =
      line.slice(0, start) + o.to + line.slice(start + o.from.length)
  }
  return { text: lines.join('\n'), changed, kept }
}

/** True for file content that is not text (a NUL byte near the start). */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}
