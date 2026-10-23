'use client'

import { useEffect } from 'react'
import { getWalletPickerOpen } from '@/lib/stellar/wallet-picker-state'

function hasNestedDialog() {
  return document.querySelector(
    '[role="dialog"]:not(.highlight-popover):not(.highlight-details-panel), [role="alertdialog"]'
  )
}

/** Keep portaled tip/delete dialogs open while dismissing passage panels outside. */
export function useHighlightPanelDismiss(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Nested dialogs own their Escape key.
      if (getWalletPickerOpen() || hasNestedDialog()) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      // The backdrop and Stellar picker are outside the nested dialog content.
      // They must never dismiss the component that owns a payment in progress.
      if (getWalletPickerOpen() || hasNestedDialog()) return
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
