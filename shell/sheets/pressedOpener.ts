import { inputModality, recentlyPressed } from '@/system/inputModality'

/**
 * The control that opened a sheet: the last one pressed by pointer (from
 * the system's own press tracking; WebKit does not focus a pressed
 * button), or the focused one when the last input was the keyboard.
 */
export function sheetOpener(): Element | null {
  return inputModality() === 'pointer'
    ? recentlyPressed()
    : (document.activeElement as Element | null)
}

/** Marks the control as opening a sheet (drawn as pressed) until the
 * returned function is called. */
export function holdPressedLook(element: Element | null): () => void {
  if (!element || element === document.body) return () => {}
  element.setAttribute('data-opening', '')
  return () => element.removeAttribute('data-opening')
}
