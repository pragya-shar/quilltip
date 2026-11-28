/**
 * When the pushed header shows, from the scroll and the reader's own input:
 * a pure model (`createHeaderOnScroll`) and the page watch that feeds it
 * (`watchHeader`). PushedHeader loads this module after the page's first
 * load; until then the header shows.
 *
 * - A scroll down of more than DOWN_PX hides it (past its own height).
 * - A scroll up shows it during a gesture of the reader's: from their own
 *   input (a wheel, a touch move, a scrolling key) until that scroll ends,
 *   however late the scroll events arrive on a busy page. A gesture ends
 *   only once the scroll its latest input asked for has come: the end of an
 *   earlier scroll (a late `scrollend`) does not end it. A press or a key
 *   that does not scroll ends it at once. A place restore, an anchor
 *   landing or a `scrollTo` has no such input, and never uncovers it over
 *   the line it just placed.
 * - At the top and at the end of the page it shows.
 * - While a pointer is down with text selected (a selection being dragged),
 *   it does not show: it would cover the handles.
 * - Focus inside it shows it, whatever the scroll, at once and with
 *   nothing to scroll into view: the page stays where it was.
 */
export const DOWN_PX = 8
/** With no `scrollend` event: how long the page must stay still after a
 * scroll event for the reader's gesture to end. */
export const QUIET_MS = 200

/** Which way an input scrolls: up (-1), down (1), or either (0, a touch). */
export type Way = -1 | 0 | 1

export type HeaderScroll = {
  y: number
  /** The page's scrollable height minus the viewport's. */
  max: number
  /** The header's own height. */
  height: number
}

/** `y`: where the page is when the watch starts. */
export function createHeaderOnScroll(y = 0) {
  let shown = true
  let lastY = y
  let seenY = y
  let gesture = false
  // The way of the reader's latest input, until a scroll that way comes.
  let awaiting: Way | null = null
  let selecting = false
  let focused = false
  return {
    shown: () => shown || focused,
    /** Whether a gesture of the reader's lasts. */
    gesturing: () => gesture,
    /** The reader's own input that scrolls the page, and its way. */
    input(way: Way) {
      gesture = true
      awaiting = way
    },
    /** The page's scroll has ended (`scrollend`, or a quiet time). The
     * gesture ends, unless its latest input's scroll has not come yet.
     * Returns whether it ended. */
    settled(): boolean {
      if (awaiting !== null) return false
      gesture = false
      return true
    },
    /** A press, or a key that does not scroll: the gesture ends now. */
    interrupt() {
      gesture = false
      awaiting = null
    },
    /** A pointer is down with text selected, or no longer. */
    selecting(on: boolean) {
      selecting = on
    },
    focus(on: boolean) {
      focused = on
    },
    scroll({ y, max, height }: HeaderScroll): boolean {
      const step = Math.sign(y - seenY)
      if (
        awaiting !== null &&
        step !== 0 &&
        (awaiting === 0 || step === awaiting)
      )
        awaiting = null
      seenY = y
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

/** The keys that scroll the page, and the way each one goes (-1 up). */
const SCROLL_KEYS = new Map<string, Way>([
  ['ArrowUp', -1],
  ['ArrowDown', 1],
  ['PageUp', -1],
  ['PageDown', 1],
  ['Home', -1],
  ['End', 1],
  [' ', 1],
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
  const model = createHeaderOnScroll(window.scrollY)
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
  // Where the page was at its last scroll event, and where focus coming
  // into the header found it.
  let seenY = window.scrollY
  let pinned: number | null = null
  const onScroll = () => {
    const y = window.scrollY
    // A browser that still scrolled to reveal the focused control (it
    // should find nothing to scroll): put the page back, once. Never
    // during the reader's own gesture.
    if (pinned !== null && !model.gesturing()) {
      const keep = pinned
      pinned = null
      if (Math.round(y) !== Math.round(keep)) {
        window.scrollTo(0, keep)
        return
      }
    }
    seenY = y
    report.titled(y > TITLE_AFTER_PX)
    publish(
      model.scroll({
        y,
        max: root.scrollHeight - window.innerHeight,
        height: node.offsetHeight,
      })
    )
    // Without `scrollend`, the scroll has ended once the page is still.
    if (model.gesturing() && !hasScrollEnd) {
      clearTimeout(quiet)
      quiet = window.setTimeout(settled, QUIET_MS)
    }
  }
  // The reader's gesture: from their own input until the scroll it asked
  // for has come and ended.
  const hasScrollEnd = 'onscrollend' in window
  let quiet = 0
  const settled = () => {
    if (model.gesturing() && model.settled()) delete node.dataset.scrolling
  }
  const interrupt = () => {
    clearTimeout(quiet)
    pinned = null
    model.interrupt()
    delete node.dataset.scrolling
  }
  const intent = (way: Way) => {
    pinned = null
    clearTimeout(quiet)
    model.input(way)
    node.dataset.scrolling = ''
  }
  const onPointerUp = () => {
    pointerDown = false
    model.selecting(false)
  }
  publish(true)
  window.addEventListener('scroll', onScroll, passive)
  if (hasScrollEnd) window.addEventListener('scrollend', settled, passive)
  // An input that cannot scroll the page (up at the top, down at the end,
  // or sideways) is no gesture: it would stay open with no scroll to end it.
  const canScroll = (way: number) =>
    way < 0
      ? window.scrollY > 0
      : way > 0 && window.scrollY < root.scrollHeight - window.innerHeight - 1
  window.addEventListener(
    'wheel',
    (event) => {
      const way = Math.sign(event.deltaY) as Way
      if (canScroll(way)) intent(way)
    },
    passive
  )
  window.addEventListener('touchmove', () => intent(0), passive)
  window.addEventListener(
    'keydown',
    (event) => {
      const key = SCROLL_KEYS.get(event.key)
      if (key === undefined) return interrupt()
      const way = event.key === ' ' && event.shiftKey ? -1 : key
      if (canScroll(way)) intent(way)
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
      interrupt()
    },
    capture
  )
  window.addEventListener('pointerup', onPointerUp, capture)
  window.addEventListener('pointercancel', onPointerUp, capture)
  node.addEventListener(
    'focusin',
    () => {
      // Back in the same step as the focus, with no slide, before the
      // browser looks for the control: its box is where it is drawn, in
      // view, so there is nothing to scroll.
      if (node.hasAttribute('data-hidden')) {
        node.dataset.revealing = ''
        node.removeAttribute('data-hidden')
        void node.offsetHeight
        requestAnimationFrame(() => delete node.dataset.revealing)
      }
      pinned = seenY
      model.focus(true)
      publish(true)
    },
    { signal: stop.signal }
  )
  node.addEventListener(
    'focusout',
    (event) => {
      if (node.contains(event.relatedTarget as Node | null)) return
      pinned = null
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
