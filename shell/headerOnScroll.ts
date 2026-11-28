/**
 * When the pushed header shows, from the scroll and the reader's own input:
 * a pure model (`createHeaderOnScroll`) and the page watch that feeds it
 * (`watchHeader`). PushedHeader loads this module after the page's first
 * load; until then the header shows.
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

/** Past this scroll the header carries the screen's title. */
export const TITLE_AFTER_PX = 140

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

/**
 * Watches the page for `node`, the pushed header: reports when it shows and
 * when it carries the title, and keeps `--qt-pushed-header-h` on <html> at
 * its visible height (0 while hidden). Marks the header `data-watching`.
 * Returns the stop.
 */
export function watchHeader(
  node: HTMLElement,
  report: { shown: (on: boolean) => void; titled: (on: boolean) => void }
): () => void {
  const model = createHeaderOnScroll()
  const root = document.documentElement
  const stop = new AbortController()
  const passive = { passive: true, signal: stop.signal }
  const capture = { capture: true, signal: stop.signal }
  let pointerDown = false
  const publish = (on: boolean) => {
    report.shown(on)
    root.style.setProperty(
      '--qt-pushed-header-h',
      on ? `${Math.round(node.offsetHeight)}px` : '0px'
    )
  }
  const onScroll = () => {
    const y = window.scrollY
    report.titled(y > TITLE_AFTER_PX)
    publish(
      model.scroll({
        y,
        max: root.scrollHeight - window.innerHeight,
        height: node.offsetHeight,
        at: performance.now(),
      })
    )
  }
  const intent = () => model.intent(performance.now())
  const onPointerUp = () => {
    pointerDown = false
    model.selecting(false)
  }
  publish(true)
  window.addEventListener('scroll', onScroll, passive)
  window.addEventListener('wheel', intent, passive)
  window.addEventListener('touchmove', intent, passive)
  window.addEventListener(
    'keydown',
    (event) => {
      if (SCROLL_KEYS.has(event.key)) intent()
    },
    { signal: stop.signal }
  )
  // No reveal while a selection is being dragged: it would cover the
  // handles.
  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection()
      model.selecting(
        pointerDown && Boolean(selection && !selection.isCollapsed)
      )
    },
    { signal: stop.signal }
  )
  window.addEventListener(
    'pointerdown',
    () => {
      pointerDown = true
    },
    capture
  )
  window.addEventListener('pointerup', onPointerUp, capture)
  window.addEventListener('pointercancel', onPointerUp, capture)
  node.addEventListener(
    'focusin',
    () => {
      model.focus(true)
      publish(true)
    },
    { signal: stop.signal }
  )
  node.addEventListener(
    'focusout',
    (event) => {
      if (node.contains(event.relatedTarget as Node | null)) return
      model.focus(false)
      onScroll()
    },
    { signal: stop.signal }
  )
  node.dataset.watching = ''
  return () => {
    stop.abort()
    delete node.dataset.watching
  }
}
