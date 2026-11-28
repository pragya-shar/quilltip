import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { SIGN_IN_PATH } from './navigation'
import { knownSheet, sheetStack } from './sheetStack'

/** The id the sign-in sheet registers under (the Account surface builds it). */
export const SIGN_IN_SHEET = 'sign-in'

/**
 * Asks the person to sign in, over the current page. Pass what they were
 * doing (`intent`, for example the tip they pressed) so the sheet can show
 * it again after sign-in; account creation never sends money by itself
 *. Returns false while no sign-in sheet is registered: the caller then
 * follows its link to the sign-in page.
 */
export function openSignIn(intent?: unknown): boolean {
  // Registered by loaded code, or declared in shell/sheets: either counts.
  if (!knownSheet(SIGN_IN_SHEET)) return false
  return sheetStack.open(SIGN_IN_SHEET, { intent })
}

/**
 * The sign-in page's address, with the way back: the one place it is
 * written, so no surface writes `/login`, `/signin` or a query of its own.
 * `SIGN_IN_PATH` is `/signin` once the shell's page is in the route tree,
 * `/login` until then; the return path goes in `returnTo`, and only a path
 * on this site (anything else falls back to `/`).
 */
export function signInHref(returnTo?: string): string {
  if (!returnTo) return SIGN_IN_PATH
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(getSafeReturnPath(returnTo))}`
}
