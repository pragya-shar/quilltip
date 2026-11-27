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
 * **The cookies**, for Today's server render (decision D22: its opening
 * skips what the reader opened or finished). Written only by the article
 * view; Today reads and validates them. Both are first-party, hold article
 * ids only (each URI-encoded, comma-separated, newest first, at most 20),
 * and are set with `Path=/; Max-Age=31536000; SameSite=Lax`:
 * - `qt_opened`: articles this browser opened, added on open;
 * - `qt_finished`: articles read to the end (98%), mirrored from the store.
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
  updatedAt: number
  finished: boolean
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
    !v.href.startsWith('/') ||
    v.href.startsWith('//') ||
    typeof v.title !== 'string' ||
    typeof v.percent !== 'number' ||
    !Number.isFinite(v.percent) ||
    typeof v.updatedAt !== 'number' ||
    !Number.isFinite(v.updatedAt)
  )
    return null
  return {
    articleId: v.articleId,
    href: v.href,
    title: v.title,
    sentence: typeof v.sentence === 'string' ? v.sentence : '',
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
  document.cookie = value
    ? `${name}=${value}; ${COOKIE_ATTRIBUTES}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Lax`
}

/** Saves a place and mirrors the finished ids. Storage may be blocked. */
export function savePlace(
  next: Omit<ReadingPlace, 'finished'> & { finished?: boolean }
) {
  try {
    const places = upsertPlace(readPlaces(), next)
    localStorage.setItem(READING_PLACE_KEY, JSON.stringify(places))
    writeCookie(
      FINISHED_COOKIE,
      places.filter((p) => p.finished).map((p) => p.articleId)
    )
  } catch {
    // Reading stays available when browser storage is blocked.
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
