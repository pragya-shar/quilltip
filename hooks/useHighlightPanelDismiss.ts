'use client'

import { useEffect } from 'react'

/** Keep portaled tip/delete dialogs open while dismissing passage panels outside. */
export function useHighlightPanelDismiss(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Nested dialogs own their Escape key.
      if (
        document.querySelector(
          '[role="dialog"]:not(.highlight-popover):not(.highlight-details-panel), [role="alertdialog"]'
        )
      )
        return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[role="dialog"], [role="alertdialog"]')) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose, enabled])
}
