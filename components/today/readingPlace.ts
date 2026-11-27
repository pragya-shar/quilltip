/**
 * A copy of the reading-place interface the article view owns
 * (`hooks/read/readingPlace.ts`, pull request 601): the key, the cookie
 * name, the entry shape and the parser, exactly as there. Today only reads.
 *
 * When pull request 601 is on this branch's base, delete this file and
 * import `READING_PLACE_KEY`, `FINISHED_COOKIE`, `ReadingPlace`,
 * `parsePlaces` and `readPlaces` from `@/hooks/read/readingPlace`; nothing
 * else changes.
 */
export const READING_PLACE_KEY = 'quilltip:reading-position:v2'
export const FINISHED_COOKIE = 'qt_finished'
export const PLACE_LIMIT = 20

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

/** One stored entry, or null. Missing `sentence` and `finished` read as
 * empty and false; anything else bad drops the entry. */
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
 * is blocked or empty. */
export function readPlaces(): ReadingPlace[] {
  try {
    return parsePlaces(localStorage.getItem(READING_PLACE_KEY))
  } catch {
    return []
  }
}
