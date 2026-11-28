/**
 * Who this browser's session token names. Convex Auth keeps the token in
 * localStorage under one key per deployment: `__convexAuthJWT_` and the
 * deployment's URL with everything but letters and digits removed (its
 * storage namespace is the client's address, `NEXT_PUBLIC_CONVEX_URL`). The
 * token's `sub` is `<userId>|<sessionId>`. A key left by another deployment
 * is never read. Read only to decide whether figures in the payments store
 * belong to the person and session here now: nothing is trusted from it
 * beyond that.
 */
const TOKEN_PREFIX = '__convexAuthJWT_'

/** The token's key for a deployment, or null with no deployment URL. */
export function tokenKey(
  url: string | undefined = process.env.NEXT_PUBLIC_CONVEX_URL
): string | null {
  return url ? `${TOKEN_PREFIX}${url.replace(/[^a-zA-Z0-9]/g, '')}` : null
}

/** Whether a `storage` event's key is this deployment's token (null: the
 * whole storage was cleared). */
export function isTokenKey(key: string | null): boolean {
  return key === null || key === tokenKey()
}

/**
 * The `<userId>|<sessionId>` pair in this deployment's session token, or
 * null when there is none, it does not parse, or its subject is not a pair.
 */
export function tokenPair(storage?: Storage): string | null {
  try {
    const key = tokenKey()
    if (!key) return null
    const token = (storage ?? window.localStorage).getItem(key) ?? ''
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    if (typeof sub !== 'string') return null
    const [userId, sessionId, ...rest] = sub.split('|')
    return userId && sessionId && rest.length === 0 ? sub : null
  } catch {
    // No storage or an unreadable token: unknown.
    return null
  }
}

/** The pair the server answered for: `<userId>|<sessionId>`. */
export function pairOf(userId: string, sessionId: string): string {
  return `${userId}|${sessionId}`
}
