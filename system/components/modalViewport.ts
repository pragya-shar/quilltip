/**
 * A modal <dialog> fitted to the visible area, above the on-screen
 * keyboard. iOS Safari leaves the layout as it is when the keyboard opens
 * and covers its bottom (it ignores interactive-widget); the visual
 * viewport says what is still visible. The dialog fills exactly that, so a
 * sheet's bottom edge sits on the keyboard, its body scrolls inside, and
 * the focused field is brought into view in the body, never by moving the
 * page. Loaded by `useModal` when a modal opens.
 */

/**
 * Brings the focused field into view inside the modal's scrolling body,
 * with a little room, and nothing else: the page behind never moves. When
 * the field is inside a `[data-sheet-keep]` block (a field with the buttons
 * that act on it, in a sheet whose buttons live in its body), the whole
 * block is brought into view if it fits, else the field.
 */
function revealFocused(dialog: HTMLDialogElement) {
  const field = document.activeElement
  if (!(field instanceof HTMLElement) || !dialog.contains(field)) return
  const body = field.closest<HTMLElement>('.qt-modal__body')
  if (!body) return
  const room = 16
  const box = body.getBoundingClientRect()
  const keep = field.closest<HTMLElement>('[data-sheet-keep]')
  const block = keep?.getBoundingClientRect()
  const at =
    block && block.height + 2 * room <= box.height
      ? block
      : field.getBoundingClientRect()
  if (at.bottom > box.bottom - room)
    body.scrollTop += at.bottom - box.bottom + room
  else if (at.top < box.top + room) body.scrollTop -= box.top + room - at.top
}

/** Fits `dialog` to the visual viewport until the returned stop runs. */
export function fitToViewport(dialog: HTMLDialogElement): () => void {
  const viewport = window.visualViewport
  const fit = () => {
    if (!viewport) return
    dialog.style.top = `${Math.round(viewport.offsetTop)}px`
    dialog.style.height = `${Math.round(viewport.height)}px`
    revealFocused(dialog)
  }
  const onFocusIn = () => revealFocused(dialog)
  fit()
  viewport?.addEventListener('resize', fit)
  viewport?.addEventListener('scroll', fit)
  dialog.addEventListener('focusin', onFocusIn)
  return () => {
    viewport?.removeEventListener('resize', fit)
    viewport?.removeEventListener('scroll', fit)
    dialog.removeEventListener('focusin', onFocusIn)
  }
}
