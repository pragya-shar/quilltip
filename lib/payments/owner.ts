/**
 * Whose figures the payments store holds. Convex Auth keeps the session
 * token in localStorage under keys starting with `__convexAuthJWT`
 * (shell/prePaint.ts reads the same prefix); its `sub` is `<userId>|<session>`.
 * Read only to decide whether figures already in the store belong to the
 * person here now: nothing is trusted from it beyond that.
 */
const TOKEN_PREFIX = '__convexAuthJWT'

/** The user id in this browser's session token, or null when there is none
 * or it cannot be read. */
export function tokenOwner(storage?: Storage): string | null {
  try {
    const store = storage ?? window.localStorage
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key?.startsWith(TOKEN_PREFIX)) continue
      const token = store.getItem(key) ?? ''
      const payload = token.split('.')[1]
      if (!payload) continue
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      const sub = (JSON.parse(json) as { sub?: unknown }).sub
      if (typeof sub === 'string' && sub) return sub.split('|')[0] ?? null
    }
  } catch {
    // No storage or an unreadable token: unknown.
  }
  return null
}
