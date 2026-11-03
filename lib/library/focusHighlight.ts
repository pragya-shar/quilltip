/** Focus the first rendered segment of the saved passage. */
export function focusLibraryHighlight(
  root: HTMLElement,
  id: string,
  reducedMotion = false
): boolean {
  const marks = root.querySelectorAll<HTMLElement>('mark[data-highlight-id]')
  const element =
    [...marks].find((mark) =>
      mark.dataset.passageStartIds?.split(' ').includes(id)
    ) ?? [...marks].find((mark) => mark.dataset.highlightId === id)
  if (!element) return false

  element.tabIndex = -1
  element.scrollIntoView({
    block: 'center',
    behavior: reducedMotion ? 'instant' : 'smooth',
  })
  element.focus({ preventScroll: true })
  return true
}
