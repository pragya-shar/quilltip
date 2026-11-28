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
 * 3. Keyboard and assistive-technology clicks always work. A click is a
 *    pointer click when it has a pointer type, a click count (`detail`),
 *    or a pointer went down on its target just before (an engine that
 *    gives a tap no count); with none of these it is the keyboard's or an
 *    assistive technology's.
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
let pointerDown: { target: EventTarget | null; at: number } | null = null

/** How recent a pointer down on a click's target makes it a pointer click. */
const POINTER_DOWN_MS = 1000

function now() {
  return performance.now()
}

/** Whether a click was made with a pointer (mouse, touch, pen). */
export function isPointerClick(
  event: {
    target: EventTarget | null
    detail: number
    pointerType?: string
  },
  at: number
): boolean {
  if (event.pointerType) return true
  if (event.detail > 0) return true
  return (
    pointerDown !== null &&
    at - pointerDown.at <= POINTER_DOWN_MS &&
    event.target instanceof Node &&
    pointerDown.target instanceof Node &&
    (pointerDown.target === event.target ||
      pointerDown.target.contains(event.target) ||
      event.target.contains(pointerDown.target))
  )
}

/** Whether a click on `target` at `at` passes: not a pointer click, no
 * hold, or a target inside a modal opened after the hold began. */
export function clickPasses(
  target: EventTarget | null,
  at: number,
  pointer: boolean
): boolean {
  if (!pointer || at >= until) return true
  const modal = target instanceof Element ? target.closest('dialog') : null
  const opened = modal ? openedAt.get(modal) : undefined
  return opened !== undefined && opened > heldAt
}

function swallow(event: MouseEvent) {
  const at = now()
  const pointer = isPointerClick(
    {
      target: event.target,
      detail: event.detail,
      pointerType: (event as Partial<PointerEvent>).pointerType,
    },
    at
  )
  if (clickPasses(event.target, at, pointer)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('click', swallow, true)
  window.addEventListener(
    'pointerdown',
    (event) => {
      pointerDown = { target: event.target, at: now() }
    },
    true
  )
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
  pointerDown = null
}
