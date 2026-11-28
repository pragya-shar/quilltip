/**
 * Session tokens for the payments tests, kept as Convex Auth keeps them: in
 * localStorage under this deployment's key (lib/payments/store.ts), with
 * `sub` = `<userId>|<sessionId>`. Needs a DOM environment.
 */
import { paymentsStore, tokenKey } from '../../lib/payments/store'

export const TEST_CONVEX_URL = 'https://unit-test-123.convex.cloud'
process.env.NEXT_PUBLIC_CONVEX_URL = TEST_CONVEX_URL

/** Reader A's first session, reader B's, and reader A signed in again. */
export const A = 'user-a|session-1'
export const B = 'user-b|session-2'
export const A_AGAIN = 'user-a|session-3'

export const jwt = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`

export function deploymentKey(): string {
  const key = tokenKey()
  if (!key) throw new Error('no test deployment URL')
  return key
}

/** Writes (or, with null, removes) this deployment's token, as a sign-in
 * in another tab would, with no event. */
export function writeToken(pair: string | null) {
  if (pair === null) window.localStorage.removeItem(deploymentKey())
  else window.localStorage.setItem(deploymentKey(), jwt(pair))
}

/** Writes the token and has the store read it. */
export function tokenNames(pair: string | null) {
  writeToken(pair)
  paymentsStore.readSession()
}

/** The `storage` event another tab's write fires here. */
export function storageEvent(key: string | null = deploymentKey()) {
  window.dispatchEvent(
    new StorageEvent('storage', { key, storageArea: window.localStorage })
  )
}
