/**
 * The control a person last pressed, so a sheet that waits for its code
 * on a first open can keep that control looking pressed until the sheet
 * draws. Taken from the press itself, not from focus: WebKit does not
 * focus a button on a pointer press.
 */
let pressed: { element: Element; at: number } | null = null

const CONTROL = 'button, a[href], [role="button"]'

function note(event: Event) {
  const target = event.target as Element | null
  const element = target?.closest?.(CONTROL)
  if (element) pressed = { element, at: Date.now() }
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', note, true)
  document.addEventListener('keydown', note, true)
}

/** The control pressed in the last `withinMs`, if it is still in the page. */
export function lastPressed(withinMs = 1000): Element | null {
  if (!pressed || Date.now() - pressed.at > withinMs) return null
  return pressed.element.isConnected ? pressed.element : null
}

/** Marks the control as opening a sheet (drawn as pressed) until the
 * returned function is called. */
export function holdPressedLook(element: Element | null): () => void {
  if (!element) return () => {}
  element.setAttribute('data-opening', '')
  return () => element.removeAttribute('data-opening')
}
