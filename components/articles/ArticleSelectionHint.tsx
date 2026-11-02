'use client'

import { useEffect, useState } from 'react'

const HINT_KEY = 'quilltip.reader.selection-hint-dismissed.v1'

export function ArticleSelectionHint() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    try {
      setVisible(localStorage.getItem(HINT_KEY) !== '1')
    } catch {
      // Guidance remains usable when browser storage is unavailable.
    }
  }, [])
  if (!visible) return null
  return (
    <div className="reader-selection-hint">
      <span>
        Select a passage to highlight it. Tip its writer if you feel like it.
      </span>
      <button
        type="button"
        aria-label="Dismiss reading tip"
        onClick={() => {
          setVisible(false)
          try {
            localStorage.setItem(HINT_KEY, '1')
          } catch {
            /* Dismiss for this visit. */
          }
        }}
      >
        ×
      </button>
    </div>
  )
}
