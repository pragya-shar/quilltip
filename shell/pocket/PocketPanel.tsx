'use client'

import { useEffect, useRef } from 'react'
import { Icon } from '@/system/components/Icon'
import {
  focusDestination,
  inputModality,
  recentlyPressed,
} from '@/system/inputModality'
import { CloseIcon } from '@/system/icons'
import { PocketBody } from './PocketBody'

/**
 * The Pocket on a desktop: a panel on the right, beside the page, not over
 * it. It takes focus on its title when it opens, Escape or Close closes it,
 * and focus goes back to the balance item.
 */
export function PocketPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    // Opened by a key: the focused control. Opened by a press: the control
    // pressed, since Safari focuses no pressed link (as useModal does).
    const active =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null
    opener.current =
      (inputModality() === 'pointer' ? recentlyPressed() : null) ?? active
    focusDestination(title.current)
    // Escape closes it while focus is inside.
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        panel.current?.contains(document.activeElement)
      ) {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const back = opener.current
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [open])
  return (
    <aside
      ref={panel}
      className="qt-pocket-panel"
      aria-labelledby="pocket-panel-title"
      data-closing={open ? undefined : ''}
    >
      <h2
        id="pocket-panel-title"
        className="qt-pocket-panel__title"
        ref={title}
        tabIndex={-1}
      >
        Balance
      </h2>
      <PocketBody />
      <button
        type="button"
        className="qt-modal__close"
        aria-label="Close the balance"
        onClick={onClose}
      >
        <Icon icon={CloseIcon} size={24} />
      </button>
    </aside>
  )
}
