import { FINISHED_COOKIE } from './readingPlace'

/**
 * The server's skip list (D22): articles this browser opened or finished,
 * from two cookies the article view writes, each a list of article ids,
 * newest first, each URI-encoded, comma-separated. Today only reads them, on
 * the server. With no script neither is written, so nothing is skipped.
 */
export { FINISHED_COOKIE }
/** Opened article ids (the article view sets it when an article opens). */
export const OPENED_COOKIE = 'qt_opened'

/** The most ids read from each cookie. */
export const COOKIE_ID_LIMIT = 20

/** A Convex document id: lowercase letters and digits. */
const ID = /^[0-9a-z]{16,64}$/

/** The ids in one cookie value: valid ids only, deduplicated, at most 20;
 * anything else is ignored. */
export function parseSkipCookie(value: string | undefined): string[] {
  if (!value) return []
  const ids: string[] = []
  for (const part of value.split(',')) {
    if (ids.length === COOKIE_ID_LIMIT) break
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

/** Finished and opened ids together, finished first, without repeats (at
 * most 40: the query's own limit). */
export function skipList(
  finished: string | undefined,
  opened: string | undefined
): string[] {
  const ids = parseSkipCookie(finished)
  for (const id of parseSkipCookie(opened)) if (!ids.includes(id)) ids.push(id)
  return ids
}
