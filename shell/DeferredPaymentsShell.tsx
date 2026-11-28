'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { paymentsStore } from '@/lib/payments/store'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60_000

/**
 * The money layer's payments shell (`components/payments/PaymentsShell`),
 * loaded after hydration, so no part of it is in a page's first load and
 * none of it runs with no script; the shell then loads the engine when it
 * is wanted. Until it arrives, a tip control reads the store's blank state
 * and the bar reads the store's balance (`shell/liveBalance.ts`); neither
 * waits on it. If its code cannot load, the figures read unavailable (the
 * balance says so, with Try again, `paymentsStore.retry`) and it tries
 * again after a delay that doubles up to five minutes. It is the only
 * payments shell on a page.
 */
export function DeferredPaymentsShell() {
  const [Shell, setShell] = useState<ComponentType | null>(null)
  useEffect(() => {
    let alive = true
    let delay = FIRST_RETRY_MS
    let timer = 0
    const load = () => {
      window.clearTimeout(timer)
      import('@/components/payments/PaymentsShell').then(
        (m) => {
          if (alive) setShell(() => m.PaymentsShell)
        },
        () => {
          if (!alive) return
          paymentsStore.fail()
          timer = window.setTimeout(load, delay)
          delay = Math.min(delay * 2, MAX_RETRY_MS)
        }
      )
    }
    const off = paymentsStore.onRetry(load)
    load()
    return () => {
      alive = false
      window.clearTimeout(timer)
      off()
    }
  }, [])
  return Shell ? <Shell /> : null
}
