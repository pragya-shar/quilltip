/**
 * Presses that land while a sheet or dialog closes. A tap that closes a
 * sheet (its Close, the scrim, a drag down) is often followed at once by a
 * second tap, or by the rest of the same gesture, and it lands on the
 * sliding panel or on whatever was under it. For a short time after a modal
 * starts to close, the shell swallows pointer presses, so none reaches a
 * control the person could not see.
 *
 * Only pointer presses: a click from Enter or Space (`detail === 0`) always
 * passes, so a keyboard user's next press is never lost. `useModal` holds
 * presses when a pointer closed it (not after Escape or a key); a surface
 * with a guard of its own drops it and, if it needs to know, asks
 * `pressesHeld()`.
 */

/** How long presses are held after a modal starts to close. */
export const PRESS_HOLD_MS = 400

let until = 0
let installed = false

function swallow(event: MouseEvent) {
  if (event.detail === 0 || !pressesHeld()) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('click', swallow, true)
}

/** Holds pointer presses for `ms` from now. */
export function holdPresses(ms = PRESS_HOLD_MS) {
  install()
  until = Math.max(until, performance.now() + ms)
}

/** Whether a pointer press now would be swallowed. */
export function pressesHeld(): boolean {
  return typeof performance !== 'undefined' && performance.now() < until
}

/** Ends a hold early (tests, and a modal that opens again at once). */
export function releasePresses() {
  until = 0
}
