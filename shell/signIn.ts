import type { SignInIntent } from '@/lib/auth/intent'
import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { SIGN_IN_PATH } from './navigation'
import { knownSheet, sheetStack } from './sheetStack'
import { isSigningOut } from './signOut/state'

/** The id the sign-in sheet registers under (the Account surface builds it). */
export const SIGN_IN_SHEET = 'sign-in'

/**
 * Asks the person to sign in, over the current page. Pass what they were
 * doing as an intent built by `tipIntent`, `keepIntent`, `publishIntent`,
 * `followIntent` or `draftIntent` (lib/auth/intent), so the sheet can show
 * it and the page can take it back after sign-in; nothing is sent by
 * signing in. The sheet reads the intent again when it loads and drops
 * anything that was not built there (saying so in the console), so the
 * person still signs in and stays on the page; this never throws. The
 * reading happens in the sheet, not here, so the intent rules stay out of
 * every page's first load. Returns false while no sign-in sheet is
 * registered: the caller then follows its link to the sign-in page.
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
  const mode =
    options.mode === 'sign-in' || options.mode === 'create'
      ? { mode: options.mode }
      : {}
  return sheetStack.open(
    SIGN_IN_SHEET,
    intent ? { intent, ...mode } : { ...mode }
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
