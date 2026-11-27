/**
 * The articles this browser finished, as a cookie the server render reads,
 * so Today never opens on an article the reader already finished. Only ids;
 * at most FINISHED_LIMIT of them (the query's own limit). The cookie is
 * written in the browser (`writeFinishedCookie`) and read on the server
 * (`parseFinishedCookie`); with no script it is simply absent.
 */
export const FINISHED_COOKIE = 'qt_finished'
export const FINISHED_LIMIT = 20

const ID = /^[a-z0-9]{1,64}$/i

/** The ids in a cookie value: ids only, deduplicated, at most the limit. */
export function parseFinishedCookie(value: string | undefined): string[] {
  if (!value) return []
  const ids: string[] = []
  for (const part of value.split('.')) {
    if (ids.length === FINISHED_LIMIT) break
    if (ID.test(part) && !ids.includes(part)) ids.push(part)
  }
  return ids
}

/** The cookie value for these ids (newest first), or '' for none. */
export function finishedCookieValue(ids: readonly string[]): string {
  return parseFinishedCookie(ids.join('.')).join('.')
}

/** Writes the cookie in the browser; clears it when there is nothing to skip. */
export function writeFinishedCookie(ids: readonly string[]) {
  try {
    const value = finishedCookieValue(ids)
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = value
      ? `${FINISHED_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
      : `${FINISHED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
  } catch {
    // Cookies blocked: Today may open on a finished article; nothing breaks.
  }
}
