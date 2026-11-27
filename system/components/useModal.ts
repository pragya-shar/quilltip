'use client'

import { useEffect, useRef, type RefObject } from 'react'

/** Open modals, so scroll stays locked until the last one closes. */
let openCount = 0

/**
 * A native modal <dialog> driven by `open`. The browser gives the focus
 * trap (the rest of the page is inert), Escape, and the top layer. This
 * adds what it does not give everywhere: focus returns to the element that
 * opened the modal, the page behind does not scroll (iOS Safari included),
 * and Escape goes through `onClose` so React stays the source of truth.
 */
export function useModal(
  open: boolean,
  onClose: () => void
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    delete dialog.dataset.closing
    if (!dialog.open) dialog.showModal()
    openCount += 1
    const root = document.documentElement
    root.dataset.scrollLocked = ''
    const onCancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      openCount -= 1
      if (openCount === 0) delete root.dataset.scrollLocked
      dialog.dataset.closing = ''
      const finish = () => {
        // Opened again before the exit finished: keep it open.
        if (dialog.dataset.closing === undefined) return
        delete dialog.dataset.closing
        if (dialog.open) dialog.close()
        if (opener?.isConnected) opener.focus({ preventScroll: true })
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      if (reduced.matches) finish()
      else window.setTimeout(finish, 200)
    }
  }, [open])

  return ref
}
