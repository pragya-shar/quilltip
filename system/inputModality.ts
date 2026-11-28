/**
 * The last way the person interacted: keyboard, or pointer (mouse, touch,
 * pen). Script focus after a press must not draw a focus ring (Chrome
 * carries `:focus-visible` from an earlier key press to the next script
 * focus; Safari does not focus a pressed button at all), so components
 * that move focus mark the target with how it was reached.
 */
let last: 'keyboard' | 'pointer' = 'pointer'
let listening = false
let pressed: { el: HTMLElement; at: number } | null = null

/** What counts as the control a press was on. */
const CONTROL =
  'button, a[href], [role="button"], [role="menuitem"], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey && !event.ctrlKey) last = 'keyboard'
    },
    true
  )
  document.addEventListener(
    'pointerdown',
    (event) => {
      last = 'pointer'
      // Safari does not focus a pressed button or link, so a modal it
      // opens has no focused opener: remember the control instead.
      const target = event.target as Element | null
      const control = target?.closest?.(CONTROL)
      pressed =
        control instanceof HTMLElement
          ? { el: control, at: performance.now() }
          : null
    },
    true
  )
}

export function inputModality(): 'keyboard' | 'pointer' {
  listen()
  return last
}

/**
 * The control the last pointer press was on, if it was within `withinMs`
 * and is still on the page: the opener of a modal that a press opened, in
 * browsers that do not focus a pressed button (Safari).
 */
export function recentlyPressed(withinMs = 2000): HTMLElement | null {
  listen()
  if (!pressed || performance.now() - pressed.at > withinMs) return null
  return pressed.el.isConnected ? pressed.el : null
}

/** Starts listening early, before the first press that opens anything. */
export function watchInputModality() {
  listen()
}

/**
 * Moves focus to an element that is a destination, not a control (a title,
 * a status, a result). It shows a ring only when the person is using a
 * keyboard.
 */
export function focusDestination(el: HTMLElement | null | undefined) {
  if (!el) return
  el.dataset.focusRing = inputModality() === 'keyboard' ? 'on' : 'off'
  el.focus({ preventScroll: true })
}
