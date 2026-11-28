import { sheetStack } from '@/shell/sheetStack'
import { SIGN_IN_SHEET } from '@/shell/signIn'

/**
 * Runs `then` once no sign-in sheet is on screen (closed and gone), at once
 * when none is; so a toast never covers the sheet.
 */
export function afterSignInSheet(then: () => void) {
  const showing = () =>
    sheetStack.get().some((entry) => entry.id === SIGN_IN_SHEET)
  if (!showing()) {
    then()
    return
  }
  const stop = sheetStack.subscribe(() => {
    if (showing()) return
    stop()
    then()
  })
}
