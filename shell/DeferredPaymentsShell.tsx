'use client'

import { useEffect, useState, type ComponentType } from 'react'

/**
 * The money layer's payments shell (`components/payments/PaymentsShell`),
 * loaded after hydration, so no part of it is in a page's first load and
 * none of it runs with no script; the shell then loads the engine when it
 * is wanted. Until it arrives, a tip control reads the store's blank state
 * and the bar reads the store's balance (`shell/liveBalance.ts`); neither
 * waits on it. A failed load leaves the page as it is.
 */
export function DeferredPaymentsShell() {
  const [Shell, setShell] = useState<ComponentType | null>(null)
  useEffect(() => {
    let alive = true
    import('@/components/payments/PaymentsShell')
      .then((m) => {
        if (alive) setShell(() => m.PaymentsShell)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return Shell ? <Shell /> : null
}
