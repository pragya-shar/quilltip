/**
 * The reader's place, as the article view keeps it in this browser. Today
 * only reads it: "Your place" is the newest article not yet finished, and
 * the finished ones go to the server as the skip list (`finished.ts`). A
 * server-side reading position (B3 `reading.mine`) replaces this later.
 *
 * Shape, newest first, at most 20 entries:
 *   { articleId, href, title, sentence?, percent, updatedAt, finished? }
 * `href` already lands at the sentence. Anything else in storage is ignored.
 */
export const READING_POSITION_KEY = 'quilltip:reading-position:v2'

export type ReadingPlace = {
  articleId: string
  href: string
  title: string
  sentence: string | null
  /** 0..1 */
  percent: number
  updatedAt: number
  finished: boolean
}

function asPlace(entry: unknown): ReadingPlace | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>
  if (typeof e.articleId !== 'string' || !e.articleId) return null
  if (typeof e.title !== 'string' || !e.title.trim()) return null
  // Same-origin paths only: a stored value never sends a reader elsewhere.
  if (
    typeof e.href !== 'string' ||
    !e.href.startsWith('/') ||
    e.href.startsWith('//')
  )
    return null
  const percent = typeof e.percent === 'number' ? e.percent : NaN
  if (!Number.isFinite(percent)) return null
  return {
    articleId: e.articleId,
    href: e.href,
    title: e.title.trim(),
    sentence:
      typeof e.sentence === 'string' && e.sentence.trim()
        ? e.sentence.trim()
        : null,
    percent: Math.min(Math.max(percent, 0), 1),
    updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0,
    finished: e.finished === true,
  }
}

/** Every valid stored place, newest first. Empty when storage is blocked. */
export function readPlaces(storage: Pick<Storage, 'getItem'>): ReadingPlace[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(READING_POSITION_KEY) ?? '[]'
    )
    if (!Array.isArray(value)) return []
    return value
      .map(asPlace)
      .filter((place): place is ReadingPlace => place !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

/** The article to pick up: the newest one started and not finished. */
export function currentPlace(places: ReadingPlace[]): ReadingPlace | null {
  return places.find((place) => !place.finished && place.percent > 0) ?? null
}

/** The ids of finished articles, newest first. */
export function finishedIds(places: ReadingPlace[]): string[] {
  return places.filter((place) => place.finished).map((p) => p.articleId)
}
