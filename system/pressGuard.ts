/**
 * Presses that land while a sheet or dialog goes away. A tap inside a sheet
 * (its Close, an action, a Cancel, the scrim, a drag down) is often followed
 * at once by a second tap, or by the rest of the same gesture, and it lands
 * on the sliding panel or on whatever was under it: under a sheet sits the
 * tip button. A lost press is safe; a doubled press can send money.
 *
 * The rule (`useModal`, through `createPressWindow`): when a modal closes
 * within PRESS_WINDOW_MS of a pointer press anywhere inside it (or on its
 * scrim or handle), pointer presses on the page are swallowed for
 * PRESS_HOLD_MS, whoever closed it (the control's own handler, a result, a
 * change of page). Never after a close by the keyboard (a key pressed in
 * the modal after its last pointer press), and never after a close with no
 * pointer press inside it in that time (a timer, a change of page). A modal
 * that opens releases the hold, so its own presses land.
 *
 * Only pointer presses: a click from Enter or Space (`detail === 0`) always
 * passes, so a keyboard user's next press is never lost.
 */

/** How long presses are held after a modal closes. */
export const PRESS_HOLD_MS = 400

/** How recent a pointer press inside the modal must be for its close to
 * hold presses. */
export const PRESS_WINDOW_MS = 1000

let until = 0
let installed = false

/**
 * One modal's recent input: its last pointer press and its last key inside
 * it. `holds(now)` says whether its close now holds presses. Pure; `now`
 * is a time in ms (performance.now()).
 */
export function createPressWindow() {
  let pressAt = -Infinity
  let keyAt = -Infinity
  return {
    press(now: number) {
      pressAt = now
    },
    key(now: number) {
      keyAt = now
    },
    holds(now: number): boolean {
      return now - pressAt <= PRESS_WINDOW_MS && pressAt >= keyAt
    },
  }
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

/** Ends a hold: a modal opens (its presses must land), or a test. */
export function releasePresses() {
  until = 0
}
