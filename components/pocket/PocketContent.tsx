'use client'

import { Pocket } from './Pocket'
import { registerPocketSheets } from './registerSheets'

// The Pocket's own sheets (receipt, Add money, Withdraw) join the shell's
// stack with the first load of this module, which the shell starts when the
// balance item is hovered, focused or pressed.
registerPocketSheets()

/**
 * The balance's content, as the shell renders it in the phone sheet and the
 * desktop panel (`shell/pocket/PocketBody`, loaded when it first opens).
 */
export function PocketContent() {
  return <Pocket />
}
