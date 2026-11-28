import type { PointerEvent } from 'react'

/**
 * Kept for the balance sheets' handlers: the shell now holds presses for a
 * moment after any sheet closes, whoever closes it (system/pressGuard.ts),
 * so there is nothing left to note here.
 */
export function notePress(event: PointerEvent) {
  void event
}
