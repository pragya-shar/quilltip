'use client'

import { useEffect, useRef, useState } from 'react'

/** Long enough for assistive technology to register an empty live region. */
const SETTLE_MS = 120

/**
 * Text for a live region that is mounted empty. Only changes after mount
 * are announced: a state that is already there when the page loads is read
 * with the page, not announced on top of it. `announceOnMount` is for a
 * component that appears because of something the user just did; its first
 * text is set after a short delay, so the empty region is registered first.
 */
export function useAnnouncement(
  text: string,
  { announceOnMount = false }: { announceOnMount?: boolean } = {}
): string {
  const [live, setLive] = useState('')
  // The text at mount, until it first changes. Compared by value, so a
  // second effect run on mount (React strict mode) is not a change.
  const baseline = useRef<string | null>(text)
  useEffect(() => {
    if (baseline.current !== null && text === baseline.current) {
      if (!announceOnMount || !text) return
      const timer = setTimeout(() => setLive(text), SETTLE_MS)
      return () => clearTimeout(timer)
    }
    baseline.current = null
    setLive(text)
  }, [text, announceOnMount])
  return live
}
