'use client'

import { useEffect, useState } from 'react'

/**
 * When a view's figures were last known current: it follows `now` while
 * `current` (online and answered) and stops when not, so an offline screen
 * can say how old its figures are. Null until the first answer.
 */
export function useAsOf(current: boolean, now: number): number | null {
  const [asOf, setAsOf] = useState<number | null>(null)
  useEffect(() => {
    if (current) setAsOf(now)
  }, [current, now])
  return asOf
}
