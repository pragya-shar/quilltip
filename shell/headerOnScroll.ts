/**
 * When the pushed header shows, from the scroll and the reader's own input:
 * a pure model (`createHeaderOnScroll`) and the page watch that feeds it
 * (`watchHeader`). PushedHeader loads this module after the page's first
 * load; until then the header shows.
 *
 * - A scroll down of more than DOWN_PX hides it (past its own height).
 * - A scroll up shows it during a gesture of the reader's: from their own
 *   input (a wheel, a touch move, a scrolling key) until that scroll ends,
 *   however late the scroll events arrive on a busy page. A place restore,
 *   an anchor landing or a `scrollTo` has no such input, and never uncovers
 *   it over the line it just placed.
 * - At the top and at the end of the page it shows.
 * - While a pointer is down with text selected (a selection being dragged),
 *   it does not show: it would cover the handles.
 * - Focus inside it shows it, whatever the scroll.
 */
export const DOWN_PX = 8
/** With no `scrollend` event: how long the page must stay still after a
 * scroll event for the reader's gesture to end. */
export const QUIET_MS = 200

export type HeaderScroll = {
  y: number
  /** The page's scrollable height minus the viewport's. */
  max: number
  /** The header's own height. */
  height: number
}

export function createHeaderOnScroll() {
  let shown = true
  let lastY = 0
  let gesture = false
  let selecting = false
  let focused = false
  return {
    shown: () => shown || focused,
    /** The reader's own scroll gesture began (true) or ended (false). */
    gesture(on: boolean) {
      gesture = on
    },
    /** A pointer is down with text selected, or no longer. */
    selecting(on: boolean) {
      selecting = on
    },
    focus(on: boolean) {
      focused = on
    },
    scroll({ y, max, height }: HeaderScroll): boolean {
      const dy = y - lastY
      if (y <= 0 || y >= max - 1) shown = true
      else if (dy > DOWN_PX && y > height) shown = false
      else if (dy < 0 && gesture && !selecting) shown = true
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
 * its visible height (0 while hidden). Marks the header `data-watching`,
 * and `data-scrolling` while a gesture of the reader's lasts. Returns the
 * stop.
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
  // Where the page was at its last scroll event: a focus moved into the
  // header scrolls nothing (WebKit reveals a control by its slid-away box).
  let seenY = window.scrollY
  const onScroll = () => {
    const y = window.scrollY
    seenY = y
    report.titled(y > TITLE_AFTER_PX)
    publish(
      model.scroll({
        y,
        max: root.scrollHeight - window.innerHeight,
        height: node.offsetHeight,
      })
    )
    // Without `scrollend`, the gesture ends once the page is still.
    if (gesturing && !hasScrollEnd) {
      clearTimeout(quiet)
      quiet = window.setTimeout(endGesture, QUIET_MS)
    }
  }
  // The reader's gesture: from their own input until that scroll ends.
  const hasScrollEnd = 'onscrollend' in window
  let gesturing = false
  let quiet = 0
  const endGesture = () => {
    clearTimeout(quiet)
    if (!gesturing) return
    gesturing = false
    model.gesture(false)
    delete node.dataset.scrolling
  }
  const intent = () => {
    clearTimeout(quiet)
    if (gesturing) return
    gesturing = true
    model.gesture(true)
    node.dataset.scrolling = ''
  }
  const onPointerUp = () => {
    pointerDown = false
    model.selecting(false)
  }
  publish(true)
  window.addEventListener('scroll', onScroll, passive)
  if (hasScrollEnd) window.addEventListener('scrollend', endGesture, passive)
  window.addEventListener('wheel', intent, passive)
  window.addEventListener('touchmove', intent, passive)
  window.addEventListener(
    'keydown',
    (event) => {
      if (SCROLL_KEYS.has(event.key)) intent()
      else endGesture()
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
      // A press is not a scroll: a scroll it causes (an anchor) is not
      // the reader's gesture.
      endGesture()
    },
    capture
  )
  window.addEventListener('pointerup', onPointerUp, capture)
  window.addEventListener('pointercancel', onPointerUp, capture)
  node.addEventListener(
    'focusin',
    () => {
      const keep = seenY
      model.focus(true)
      publish(true)
      requestAnimationFrame(() => {
        if (Math.round(window.scrollY) !== Math.round(keep))
          window.scrollTo(0, keep)
      })
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
    clearTimeout(quiet)
    delete node.dataset.scrolling
    delete node.dataset.watching
  }
}
