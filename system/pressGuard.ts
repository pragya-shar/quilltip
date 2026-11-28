/**
 * Presses that land while a sheet or dialog goes away. A tap on a modal
 * (its Close, an action, a Cancel, the scrim, a drag down) is often
 * followed at once by a second tap, or by the rest of the same gesture, and
 * it lands on whatever was under the modal: under a sheet sits the tip
 * button. A lost press is safe; a doubled press can send money.
 *
 * The rule, with no conditions on why the modal closed:
 * 1. When any modal closes or unmounts, for any reason, at time T, a hold
 *    runs until T + PRESS_HOLD_MS.
 * 2. During a hold, a pointer click does nothing, anywhere on the page,
 *    unless its target is inside a modal that opened after T.
 * 3. Keyboard and assistive-technology clicks (`detail === 0`) always work.
 * 4. Holds extend: a second close at T2 moves the end to T2 +
 *    PRESS_HOLD_MS, and the exception then needs a modal opened after T2.
 * 5. The hold starts with the close itself (`useModal`'s layout-effect
 *    cleanup), so there is no moment between the modal leaving the page and
 *    the hold.
 */

/** How long pointer clicks are held after a modal closes. */
export const PRESS_HOLD_MS = 400

// Holds and opens in the order they happened (a counter, not a time: a
// modal opened in the same commit as a close is after it).
let order = 0
let heldAt = 0
let until = 0
let installed = false
const openedAt = new WeakMap<Element, number>()

function now() {
  return performance.now()
}

/** Whether a pointer click on `target` at `at` passes: no hold, or a
 * target inside a modal opened after the hold began. Pure on its inputs. */
export function clickPasses(
  target: EventTarget | null,
  at: number,
  detail: number
): boolean {
  if (detail === 0 || at >= until) return true
  const modal = target instanceof Element ? target.closest('dialog') : null
  const opened = modal ? openedAt.get(modal) : undefined
  return opened !== undefined && opened > heldAt
}

function swallow(event: MouseEvent) {
  if (clickPasses(event.target, now(), event.detail)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('click', swallow, true)
}

/** A modal closed or unmounted: hold pointer clicks for `ms` from now. */
export function holdPresses(ms = PRESS_HOLD_MS) {
  install()
  heldAt = ++order
  until = Math.max(until, now() + ms)
}

/** A modal opened: its own clicks pass during a hold that began before. */
export function noteModalOpened(modal: Element) {
  install()
  openedAt.set(modal, ++order)
}

/** Whether a pointer click on the page now would be swallowed. */
export function pressesHeld(): boolean {
  return typeof performance !== 'undefined' && now() < until
}

/** For tests: no hold. */
export function resetPresses() {
  heldAt = ++order
  until = 0
}
