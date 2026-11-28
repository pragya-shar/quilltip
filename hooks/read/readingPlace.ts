/**
 * The reader's places: the one definition the article view (writer) and
 * Today's "Your place" row (reader) import. They belong to this browser,
 * not to the account: Today shows them signed in or not, and the shell
 * clears them on sign-out (`clearReadingPlaces`). Callers use `readPlaces`,
 * `savePlace`, `markOpened` and `clearReadingPlaces`, never the storage, so
 * the source can move to the server (a later backend package) without them
 * changing. Nothing here is private beyond what this browser already holds.
 *
 * **The store**, `localStorage['quilltip:reading-position:v2']`: newest
 * first, at most 20 (the oldest dropped); finished articles stay, with
 * `finished: true`, so Today never opens on one.
 *
 * **The cookies**, for Today's server render (its opening skips what
 * the reader opened or finished). Written only by the article
 * view; Today reads and validates them. Both are first-party, hold article
 * ids only (each URI-encoded, comma-separated, newest first, at most 20),
 * and are set with `Path=/; Max-Age=31536000; SameSite=Lax`, and `Secure`
 * on https:
 * - `qt_opened`: articles this browser opened, added on open;
 * - `qt_finished`: articles read to the end (98%), mirrored from the store.
 *
 * **Removing a place** (`removePlace`, Shelf's remove with Undo) forgets
 * where the reader was: no "Your place" row, no resume. It does not unread
 * the article: `qt_opened` keeps its id, and a finished article stays in
 * `qt_finished` until it ages out, so Today does not offer it again as new.
 * `restorePlace` puts the removed entry back where it was.
 *
 * `href` is the article's own URL (a site path, no `#anchor`): opening it
 * returns the reader to their place (`useReadingPosition`) with nothing
 * chosen, so resume never selects a line or arms the tip bar; an anchor
 * would turn the return off.
 */
export const READING_PLACE_KEY = 'quilltip:reading-position:v2'
export const FINISHED_COOKIE = 'qt_finished'
export const OPENED_COOKIE = 'qt_opened'
export const PLACE_LIMIT = 20
/** The legacy store of `lib/articles/readingProgress.ts`, cleared with these. */
const LEGACY_PROGRESS_KEY = 'quilltip:reading-progress:v1'
const COOKIE_ATTRIBUTES = 'Path=/; Max-Age=31536000; SameSite=Lax'
/** Share of the body that has passed the bottom of the screen at the end. */
export const FINISHED_AT = 0.98
const SENTENCE_CHARS = 80

export type ReadingPlace = {
  articleId: string
  href: string
  title: string
  /** The sentence at the reading line, at most 80 characters. */
  sentence: string
  /** How much has been read, 0 to 1. */
  percent: number
  /** The sentence's start in the body's text, where the view returns. */
  at?: number
  updatedAt: number
  finished: boolean
}

const PLACE_ORIGIN = 'https://site.invalid'

/**
 * `href` as a path on this site (`/…?…`), normalised, or null. A backslash,
 * a space or a control character refuses it before parsing, since URL
 * parsers drop tabs and newlines and read `\` as `/`; the parsed address
 * must keep this site's origin, so `//host`, `/\host` and schemes fail,
 * and its path must not start with `//` (`/.//host` normalises to it, and a
 * browser reads that as another host).
 */
export function sitePath(href: string): string | null {
  if (!href.startsWith('/') || /[\\\s\u0000-\u001f\u007f-\u009f]/.test(href))
    return null
  try {
    const url = new URL(href, PLACE_ORIGIN)
    if (url.origin !== PLACE_ORIGIN || url.pathname.startsWith('//'))
      return null
    return url.pathname + url.search
  } catch {
    return null
  }
}

/** Whether `href` is a path on this site (`sitePath`). */
export function isSitePath(href: string): boolean {
  return sitePath(href) !== null
}

/** One stored entry, or null. Missing `sentence` and `finished` (older or
 * hand-written entries) read as empty and false; anything else bad drops
 * the entry. */
function toPlace(value: unknown): ReadingPlace | null {
  const v = value as Partial<ReadingPlace> | null
  if (
    !v ||
    typeof v !== 'object' ||
    typeof v.articleId !== 'string' ||
    !v.articleId ||
    typeof v.href !== 'string' ||
    !isSitePath(v.href) ||
    typeof v.title !== 'string' ||
    typeof v.percent !== 'number' ||
    !Number.isFinite(v.percent) ||
    typeof v.updatedAt !== 'number' ||
    !Number.isFinite(v.updatedAt)
  )
    return null
  return {
    articleId: v.articleId,
    href: sitePath(v.href) as string,
    title: v.title,
    sentence: typeof v.sentence === 'string' ? v.sentence : '',
    ...(Number.isSafeInteger(v.at) && (v.at as number) >= 0
      ? { at: v.at }
      : {}),
    percent: Math.max(0, Math.min(1, v.percent)),
    updatedAt: v.updatedAt,
    finished: v.finished === true,
  }
}

/** The stored places, or none when the value is corrupt. */
export function parsePlaces(text: string | null): ReadingPlace[] {
  try {
    const value: unknown = JSON.parse(text ?? '[]')
    if (!Array.isArray(value)) return []
    return value
      .map(toPlace)
      .filter((place): place is ReadingPlace => place !== null)
      .slice(0, PLACE_LIMIT)
  } catch {
    return []
  }
}

/** The reader's places in this browser, newest first; none when storage
 * is blocked or empty. The one read callers use. */
export function readPlaces(): ReadingPlace[] {
  try {
    return parsePlaces(localStorage.getItem(READING_PLACE_KEY))
  } catch {
    return []
  }
}

/** Cuts a sentence to 80 characters at a word, with an ellipsis. */
export function shortSentence(sentence: string): string {
  const text = sentence.replace(/\s+/g, ' ').trim()
  if (text.length <= SENTENCE_CHARS) return text
  const cut = text.slice(0, SENTENCE_CHARS - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * The list with `next` first. A finished article stays finished; the
 * sentence of a finished article is kept from before the end.
 */
export function upsertPlace(
  places: ReadingPlace[],
  next: Omit<ReadingPlace, 'finished'> & { finished?: boolean }
): ReadingPlace[] {
  const before = places.find((p) => p.articleId === next.articleId)
  const finished = Boolean(next.finished || before?.finished)
  const place: ReadingPlace = {
    ...next,
    percent: Math.max(0, Math.min(1, next.percent)),
    sentence: shortSentence(next.sentence || before?.sentence || ''),
    finished,
  }
  return [place, ...places.filter((p) => p.articleId !== next.articleId)].slice(
    0,
    PLACE_LIMIT
  )
}

/** The cookie's value: finished article ids, newest first, comma-separated. */
export function finishedCookieValue(places: ReadingPlace[]): string {
  return places
    .filter((p) => p.finished)
    .map((p) => encodeURIComponent(p.articleId))
    .join(',')
}

/** The article ids in a cookie header's `name`, newest first, at most 20. */
export function cookieIds(cookieHeader: string, name: string): string[] {
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  if (!pair) return []
  return pair
    .slice(name.length + 1)
    .split(',')
    .map((id) => {
      try {
        return decodeURIComponent(id)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .slice(0, PLACE_LIMIT)
}

/** The ids with `id` first, once, at most 20. */
export function withOpened(ids: string[], id: string): string[] {
  return [id, ...ids.filter((other) => other !== id)].slice(0, PLACE_LIMIT)
}

function writeCookie(name: string, ids: string[]) {
  const value = ids.map(encodeURIComponent).join(',')
  // Secure wherever the page is served over https.
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = value
    ? `${name}=${value}; ${COOKIE_ATTRIBUTES}${secure}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}

/**
 * The finished ids for the cookie: the store's, newest first, then ids the
 * cookie already holds for places since removed, at most 20.
 */
export function finishedIds(
  places: ReadingPlace[],
  cookie: string[]
): string[] {
  const stored = places.filter((p) => p.finished).map((p) => p.articleId)
  const known = new Set(places.map((p) => p.articleId))
  return [...stored, ...cookie.filter((id) => !known.has(id))].slice(
    0,
    PLACE_LIMIT
  )
}

function writePlaces(places: ReadingPlace[]) {
  localStorage.setItem(READING_PLACE_KEY, JSON.stringify(places))
  writeCookie(
    FINISHED_COOKIE,
    finishedIds(places, cookieIds(document.cookie, FINISHED_COOKIE))
  )
}

/** Saves a place and mirrors the finished ids. Storage may be blocked. */
export function savePlace(
  next: Omit<ReadingPlace, 'finished'> & { finished?: boolean }
) {
  try {
    writePlaces(upsertPlace(readPlaces(), next))
  } catch {
    // Reading stays available when browser storage is blocked.
  }
}

/** A removed place and where it stood, for `restorePlace`. */
export type RemovedPlace = { place: ReadingPlace; index: number }

/**
 * Forgets the place of one article (see the header for what it keeps).
 * Returns what `restorePlace` needs, or null when there was none.
 */
export function removePlace(articleId: string): RemovedPlace | null {
  try {
    const places = readPlaces()
    const index = places.findIndex((p) => p.articleId === articleId)
    if (index < 0) return null
    const place = places[index]!
    writePlaces(places.filter((_, i) => i !== index))
    return { place, index }
  } catch {
    return null
  }
}

/**
 * Puts a removed place back at its position, unless the article has a newer
 * place by now (the reader opened it again), which wins.
 */
export function restorePlace(removed: RemovedPlace) {
  try {
    const places = readPlaces()
    if (places.some((p) => p.articleId === removed.place.articleId)) return
    const next = [...places]
    next.splice(Math.min(removed.index, next.length), 0, removed.place)
    writePlaces(next.slice(0, PLACE_LIMIT))
  } catch {
    // Storage may be blocked; there is nothing to restore then.
  }
}

/** Records that this browser opened an article (`qt_opened`). */
export function markOpened(articleId: string) {
  try {
    writeCookie(
      OPENED_COOKIE,
      withOpened(cookieIds(document.cookie, OPENED_COOKIE), articleId)
    )
  } catch {
    // Cookies may be blocked; reading is unaffected.
  }
}

/**
 * Forgets every reading place in this browser: the store, the legacy
 * scroll positions and both cookies. The shell calls it on sign-out.
 */
export function clearReadingPlaces() {
  try {
    localStorage.removeItem(READING_PLACE_KEY)
    localStorage.removeItem(LEGACY_PROGRESS_KEY)
  } catch {
    // Storage may be blocked; there is nothing to clear then.
  }
  try {
    writeCookie(FINISHED_COOKIE, [])
    writeCookie(OPENED_COOKIE, [])
  } catch {
    // Cookies may be blocked.
  }
}
