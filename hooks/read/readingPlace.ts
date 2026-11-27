/**
 * The reader's places, kept in this browser for Today's "Your place" row
 * (agreed with the Today surface): newest first, at most 20, finished
 * articles kept with `finished: true` so Today never opens on one. The
 * article view writes it; Today only reads it. The ids of finished
 * articles are mirrored into a cookie so the server render can skip them.
 *
 * `href` is the article's URL with no `#anchor`: opening it returns the
 * reader to their place (`useReadingPosition`), and an anchor would turn
 * that off.
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

function isPlace(value: unknown): value is ReadingPlace {
  const v = value as ReadingPlace
  return (
    !!v &&
    typeof v.articleId === 'string' &&
    typeof v.href === 'string' &&
    typeof v.title === 'string' &&
    typeof v.sentence === 'string' &&
    Number.isFinite(v.percent) &&
    Number.isFinite(v.updatedAt) &&
    typeof v.finished === 'boolean'
  )
}

/** The stored places, or none when storage is blocked or the value is bad. */
export function parsePlaces(text: string | null): ReadingPlace[] {
  try {
    const value: unknown = JSON.parse(text ?? '[]')
    return Array.isArray(value)
      ? value.filter(isPlace).slice(0, PLACE_LIMIT)
      : []
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
    const places = upsertPlace(
      parsePlaces(localStorage.getItem(READING_PLACE_KEY)),
      next
    )
    localStorage.setItem(READING_PLACE_KEY, JSON.stringify(places))
    const finished = finishedCookieValue(places)
    document.cookie = finished
      ? `${FINISHED_COOKIE}=${finished}; Path=/; Max-Age=31536000; SameSite=Lax`
      : `${FINISHED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  } catch {
    // Reading stays available when browser storage is blocked.
  }
}
