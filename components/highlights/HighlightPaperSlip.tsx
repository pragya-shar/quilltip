'use client'

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Keep passage paper above site chrome and below nested payment dialogs. */
export function HighlightPaperSlip({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div className="passage-slip-backdrop" aria-hidden="true" />
      {children}
    </>,
    document.body
  )
}
