/**
 * The reader's places: the one definition the article view (writer) and
 * Today's "Your place" row (reader) import. Kept in this browser, so a
 * signed-out reader's place survives a reload: newest first, at most 20
 * (the oldest dropped), finished articles kept with `finished: true` so
 * Today never opens on one. The article view also mirrors the finished ids
 * into the `qt_finished` cookie for the server render; Today only reads.
 * Callers use `readPlaces` and `savePlace`, never the storage, so the
 * source can move to the server (a later backend package) without them
 * changing. Nothing here is private beyond what this browser already holds.
 *
 * `href` is the article's own URL (a site path, no `#anchor`): opening it
 * returns the reader to their place (`useReadingPosition`) with nothing
 * chosen, so resume never selects a line or arms the tip bar; an anchor
 * would turn the return off.
 */
export const READING_PLACE_KEY = 'quilltip:reading-position:v2'
export const FINISHED_COOKIE = 'qt_finished'
export const PLACE_LIMIT = 20
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

/** Saves a place and mirrors the finished ids. Storage may be blocked. */
export function savePlace(
  next: Omit<ReadingPlace, 'finished'> & { finished?: boolean }
) {
  try {
    const places = upsertPlace(readPlaces(), next)
    localStorage.setItem(READING_PLACE_KEY, JSON.stringify(places))
    const finished = finishedCookieValue(places)
    document.cookie = finished
      ? `${FINISHED_COOKIE}=${finished}; Path=/; Max-Age=31536000; SameSite=Lax`
      : `${FINISHED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  } catch {
    // Reading stays available when browser storage is blocked.
  }
}
