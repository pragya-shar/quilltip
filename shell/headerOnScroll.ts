/**
 * When the pushed header shows, from the scroll and the reader's own input.
 * Pure: the component feeds it events and reads `shown`.
 *
 * - A scroll down of more than DOWN_PX hides it (past its own height).
 * - A scroll up shows it, but only within INTENT_MS of the reader's own
 *   input (a wheel, a touch move, a scrolling key): a place restore, an
 *   anchor landing or a `scrollTo` never uncovers it over the line it just
 *   placed.
 * - At the top and at the end of the page it shows.
 * - While a pointer is down with text selected (a selection being dragged),
 *   it does not show: it would cover the handles.
 * - Focus inside it shows it, whatever the scroll.
 */
export const DOWN_PX = 8
export const INTENT_MS = 300

export type HeaderScroll = {
  y: number
  /** The page's scrollable height minus the viewport's. */
  max: number
  /** The header's own height. */
  height: number
  at: number
}

export function createHeaderOnScroll() {
  let shown = true
  let lastY = 0
  let intentAt = -Infinity
  let selecting = false
  let focused = false
  return {
    shown: () => shown || focused,
    /** The reader's own scrolling input. */
    intent(at: number) {
      intentAt = at
    },
    /** A pointer is down with text selected, or no longer. */
    selecting(on: boolean) {
      selecting = on
    },
    focus(on: boolean) {
      focused = on
    },
    scroll({ y, max, height, at }: HeaderScroll): boolean {
      const dy = y - lastY
      if (y <= 0 || y >= max - 1) shown = true
      else if (dy > DOWN_PX && y > height) shown = false
      else if (dy < 0 && at - intentAt <= INTENT_MS && !selecting) shown = true
      if (Math.abs(dy) > DOWN_PX || dy < 0 || y <= 0) lastY = y
      return shown || focused
    },
  }
}
