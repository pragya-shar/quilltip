'use client'

import { LocalPaymentsShell } from './LocalPaymentsShell'
import { Pocket } from './Pocket'

/**
 * The balance's content, as the shell renders it in the phone sheet and the
 * desktop panel (`shell/pocket/PocketBody`, loaded when it first opens). The
 * /pocket page renders `PocketPage`, the same content under its own title.
 */
export function PocketContent() {
  return (
    <>
      <LocalPaymentsShell />
      <Pocket />
    </>
  )
}
