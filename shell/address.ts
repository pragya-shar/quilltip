/**
 * A change of the address inside one page view: a surface that renames its
 * own page (Write, once the account holds a draft: `/write/l-…` to
 * `/write/<id>`) without the person going anywhere. Next.js treats a
 * `history.replaceState` to a new path like any change of path, and so
 * would the shell: it would switch the reading faces under the person's
 * eyes and close the open sheets. Through this function, the shell treats
 * that change as the same page view:
 * - no reading-face upgrade, no closing of the sheets, no "navigated" mark;
 * - the header's back sees the same history entry with a new path, so Back
 *   still leaves to where the reader came from;
 * - focus and scroll stay where they are (the shell moves neither).
 * A real navigation after it behaves as usual, the upgrade included.
 */

let inView: string | null = null

/** Replaces the address with `url` (same origin), as the same page view. */
export function replaceAddressInView(url: string) {
  const next = new URL(url, window.location.href)
  if (next.origin !== window.location.origin)
    throw new Error('replaceAddressInView: the address must stay on this site')
  inView = next.pathname
  window.history.replaceState(null, '', next.href)
}

/** Whether the shell sees `pathname` because of replaceAddressInView. */
export function isAddressInView(pathname: string): boolean {
  return inView !== null && inView === pathname
}

/** The shell has handled the change. */
export function settleAddressInView() {
  inView = null
}
