/**
 * The last way the person interacted: keyboard, or pointer (mouse, touch,
 * pen). Script focus after a press must not draw a focus ring (Chrome
 * carries `:focus-visible` from an earlier key press to the next script
 * focus; Safari does not focus a pressed button at all), so components
 * that move focus mark the target with how it was reached.
 */
let last: 'keyboard' | 'pointer' = 'pointer'
let listening = false

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
  document.addEventListener('pointerdown', () => (last = 'pointer'), true)
}

export function inputModality(): 'keyboard' | 'pointer' {
  listen()
  return last
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
