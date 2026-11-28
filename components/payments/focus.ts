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

/**
 * False inside a dialog that has not yet placed its own first focus
 * (components/ui/dialog-focus marks it). A notice that mounts with its
 * dialog leaves first focus to the dialog and is announced instead.
 */
export function dialogReady(root: HTMLElement | null): boolean {
  const dialog = root?.closest('[role="dialog"], [role="alertdialog"]')
  return !dialog || dialog.hasAttribute('data-focus-ready')
}
