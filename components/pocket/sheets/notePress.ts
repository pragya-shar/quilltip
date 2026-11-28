import type { PointerEvent } from 'react'
import { notePressClose } from '@/system/pressGuard'

/**
 * A pointer press anywhere inside a balance sheet. If the sheet closes
 * within the shell's window after it (about 1 s), whoever closes it, the
 * shell holds presses on the page under it for a moment, so a second tap
 * on Done or Close never presses a control there. The shell's own sheet
 * notes only its Close, its scrim and a drag; this notes the buttons
 * inside the body too.
 */
export function notePress(event: PointerEvent) {
  if (event.isPrimary) notePressClose()
}
