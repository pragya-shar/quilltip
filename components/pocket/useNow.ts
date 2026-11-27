'use client'

import { useEffect, useState } from 'react'

/** The time, updated every `everyMs`, for "4 min ago". Replaced by
 * `hooks/payments/useNow` when pull request 561 is merged. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return now
}
