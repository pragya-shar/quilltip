import { sheetFor } from './sheetRegistry'
import { sheetStack } from './sheetStack'

/** The id the sign-in sheet registers under (the Account surface builds it). */
export const SIGN_IN_SHEET = 'sign-in'

/**
 * Asks the person to sign in, over the current page. Pass what they were
 * doing (`intent`, for example the tip they pressed) so the sheet can show
 * it again after sign-in; account creation never sends money by itself
 * (D15). Returns false while no sign-in sheet is registered: the caller then
 * follows its link to the sign-in page.
 */
export function openSignIn(intent?: unknown): boolean {
  if (!sheetFor(SIGN_IN_SHEET)) return false
  sheetStack.open(SIGN_IN_SHEET, { intent })
  return true
}
