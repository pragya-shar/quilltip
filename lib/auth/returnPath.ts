import { getSafeReturnPath } from './safeReturnPath'

/**
 * Where a person goes back to after signing in: a path on this site and
 * nothing else. Refused, with the fallback returned instead: anything that
 * is not a string, longer than RETURN_PATH_MAX, with control characters,
 * not starting with one "/", starting "//" or "/\" (another host to a
 * browser), carrying a scheme ("https:", "javascript:"), any backslash, or
 * any of these once percent-decoded (up to three times, as browsers and
 * servers may decode again).
 */
export const RETURN_PATH_MAX = 512

const BASE = 'https://quilltip.invalid'

function safeOnce(path: string): boolean {
  if (path.length === 0 || path.length > RETURN_PATH_MAX) return false
  for (const char of path) {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127) return false
  }
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('\\')) return false
  if (/^\/*[a-z][a-z0-9+.-]*:/i.test(path)) return false
  try {
    const url = new URL(path, BASE)
    if (url.origin !== BASE) return false
  } catch {
    return false
  }
  return true
}

export function sameSitePath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string') return fallback
  const path = raw.trim()
  let current = path
  for (let round = 0; round < 4; round += 1) {
    if (!safeOnce(current)) return fallback
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return fallback
    }
    if (decoded === current) return path
    current = decoded
  }
  // Still changing after three decodings: refuse rather than guess.
  return fallback
}

/** Whether a same-site path is the sign-in page or below it. */
function isSignInPage(path: string): boolean {
  const page = path.split(/[?#]/)[0]!.toLowerCase().replace(/\/+$/, '')
  return page === '/signin' || page.startsWith('/signin/')
}

/** The way back from `/signin` and `/signin/reset`: their `returnTo`, as
 * `signInHref` (shell/signIn.ts) writes it, checked again on read by the
 * same function and then by `sameSitePath`; `/` otherwise. A way back to
 * the sign-in pages themselves is refused too: a signed-in arrival there
 * goes back at once, so it would never stop. */
export function returnPathFrom(params: {
  get(name: string): string | null
}): string {
  const path = sameSitePath(getSafeReturnPath(params.get('returnTo')))
  return isSignInPage(decodeURIComponent(path)) ? '/' : path
}

/** The return path on a link to an older sign-in page (`/login`,
 * `/register`, `/forgot-password`, `/reset-password`): `returnTo`, `next`
 * or `redirect`, the three names the older pages read and wrote. Only the
 * redirects to `/signin` read these; they write `returnTo`. */
export function legacyReturnPathFrom(params: {
  get(name: string): string | null
}): string {
  for (const name of ['returnTo', 'next', 'redirect']) {
    const value = params.get(name)
    const safe = sameSitePath(getSafeReturnPath(value, ''), '')
    if (safe !== '') return safe
  }
  return '/'
}
