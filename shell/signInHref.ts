import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { SIGN_IN_PATH } from './navigation'
import { isSigningOut } from './signOut/state'

/**
 * The sign-in page's address, with the way back: the one place it is
 * written, so no surface writes `/login`, `/signin` or a query of its own.
 * `SIGN_IN_PATH` is `/signin` once the shell's page is in the route tree,
 * `/login` until then; the return path goes in `returnTo` (only a path on
 * this site; anything else falls back to `/`), and is left out while a
 * sign-out runs (shell/signOut/session.ts): the reader asked to leave.
 */
export function signInHref(
  returnTo?: string,
  storage: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
  > | null = null
): string {
  if (!returnTo || isSigningOut(storage)) return SIGN_IN_PATH
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(getSafeReturnPath(returnTo))}`
}
