/**
 * Whether a payment component may move focus: true when nothing more
 * specific than the component holds it — the page, the component itself, or
 * a container around it. Safari does not focus a button on click, so after
 * "Send tip" focus stays on the dialog around it. A control the reader moved
 * to keeps focus.
 */
export function focusLost(root: HTMLElement | null): boolean {
  const active = document.activeElement
  return (
    !active ||
    active === document.body ||
    (!!root && (root.contains(active) || active.contains(root)))
  )
}
