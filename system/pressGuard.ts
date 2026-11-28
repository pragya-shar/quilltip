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
 * presses only when the modal's own Close, its scrim or a drag down closed
 * it (`notePressClose`): never after Escape or a key, and never after a
 * close by a script or a timer (a path change, a sheet that closes itself
 * after a result), whose next tap is the person's own; a surface
 * with a guard of its own drops it and, if it needs to know, asks
 * `pressesHeld()`.
 */

/** How long presses are held after a modal starts to close. */
export const PRESS_HOLD_MS = 400

let until = 0
let installed = false
let pressClosedAt = -Infinity

/** How long a noted press-close waits for its modal to close. */
const PRESS_CLOSE_MS = 1000

/** A modal's own Close button, scrim or drag down closed it with a
 * pointer: its close holds presses. Called by Sheet and Dialog. */
export function notePressClose() {
  pressClosedAt = performance.now()
}

/** Whether the close now is a noted press-close; it is taken once. */
export function takePressClose(): boolean {
  const noted = performance.now() - pressClosedAt <= PRESS_CLOSE_MS
  pressClosedAt = -Infinity
  return noted
}

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
