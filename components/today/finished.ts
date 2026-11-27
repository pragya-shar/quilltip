import { FINISHED_COOKIE } from './readingPlace'

/**
 * The server's skip list: the `qt_finished` cookie, which the article view
 * writes (finished article ids, newest first, each URI-encoded,
 * comma-separated). Today only reads it, on the server. With no script the
 * cookie is never written, so a reader with no script is never skipped.
 */
export { FINISHED_COOKIE }

/** The most ids the query takes (`today.opening`'s EXCLUDE_LIMIT). */
export const FINISHED_LIMIT = 20

const ID = /^[a-z0-9]{1,64}$/i

/** The ids in a cookie value: ids only, deduplicated, at most the limit. */
export function parseFinishedCookie(value: string | undefined): string[] {
  if (!value) return []
  const ids: string[] = []
  for (const part of value.split(',')) {
    if (ids.length === FINISHED_LIMIT) break
    let id: string
    try {
      id = decodeURIComponent(part).trim()
    } catch {
      continue
    }
    if (ID.test(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}
