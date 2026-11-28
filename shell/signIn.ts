import { parseIntent, type SignInIntent } from '@/lib/auth/intent'
import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { SIGN_IN_PATH } from './navigation'
import { knownSheet, sheetStack } from './sheetStack'
import { isSigningOut } from './signOut/state'

/** The id the sign-in sheet registers under (the Account surface builds it). */
export const SIGN_IN_SHEET = 'sign-in'

/**
 * Asks the person to sign in, over the current page. Pass what they were
 * doing as an intent built by `tipIntent`, `keepIntent`, `publishIntent` or
 * `followIntent` (lib/auth/intent), so the sheet can show it and the page
 * can take it back after sign-in; nothing is sent by signing in. An intent
 * that was not built there is refused: an error in development, and in
 * production the sheet opens without it, so the person still signs in and
 * stays on the page (the sheet's way back is the page itself); it never
 * throws there. Returns false while no sign-in sheet is registered: the
 * caller then follows its link to the sign-in page.
 */
export function openSignIn(
  intent?: SignInIntent | null,
  options: {
    /** Which form the sheet starts with. By default: creating an account
     * when it opens from an act (an intent), signing in otherwise. */
    mode?: 'sign-in' | 'create'
  } = {}
): boolean {
  // Registered by loaded code, or declared in shell/sheets: either counts.
  if (!knownSheet(SIGN_IN_SHEET)) return false
  let kept: SignInIntent | null = null
  try {
    kept = intent ? parseIntent(intent) : null
  } catch {
    // A value whose reading throws is no intent.
  }
  if (intent && !kept) {
    const message =
      'openSignIn: that intent is not valid. Build it with tipIntent, keepIntent, publishIntent or followIntent from lib/auth/intent.'
    if (process.env.NODE_ENV !== 'production') throw new Error(message)
    console.error(message)
  }
  const mode =
    options.mode === 'sign-in' || options.mode === 'create'
      ? { mode: options.mode }
      : {}
  return sheetStack.open(
    SIGN_IN_SHEET,
    kept ? { intent: kept, ...mode } : { ...mode }
  )
}

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
