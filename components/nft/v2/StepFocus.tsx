'use client'

import { useEffect, useRef } from 'react'

/** Keeps focus inside the dialog when a step replaces the focused control. */
export function StepFocus({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.contains(document.activeElement)) {
      const heading = el.querySelector<HTMLElement>(
        '.pay-progress-heading, .pay-panel-title, h3'
      )
      ;(heading ?? el).focus({ preventScroll: true })
    }
  }, [])
  return (
    <div ref={ref} tabIndex={-1} className="nft-v2-step">
      {children}
    </div>
  )
}
