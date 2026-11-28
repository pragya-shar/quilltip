'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { paymentsStore } from '@/lib/payments/store'

export const FIRST_RETRY_MS = 5_000
export const MAX_RETRY_MS = 5 * 60_000

/**
 * Runs `attempt` now and, after each failure, again after a delay that
 * starts at `FIRST_RETRY_MS` and doubles up to `MAX_RETRY_MS`, for as long
 * as the page is open: a backend that comes back is picked up with no
 * reload. `now()` tries again at once and starts the delays over (Try
 * again); `stop()` ends it, and nothing runs after.
 */
export function loadWithBackoff<T>(
  attempt: () => Promise<T>,
  onLoad: (value: T) => void,
  onFail: () => void
) {
  let stopped = false
  let delay = FIRST_RETRY_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    clearTimeout(timer)
    attempt().then(
      (value) => {
        if (!stopped) onLoad(value)
      },
      () => {
        if (stopped) return
        onFail()
        timer = setTimeout(run, delay)
        delay = Math.min(delay * 2, MAX_RETRY_MS)
      }
    )
  }
  run()
  return {
    now() {
      if (stopped) return
      delay = FIRST_RETRY_MS
      run()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

/** How the shell's code is loaded; a test replaces `load`. */
export const shellImport = {
  load: () => import('@/components/payments/PaymentsShell'),
}

/**
 * The money layer's payments shell (`components/payments/PaymentsShell`),
 * loaded after hydration, so no part of it is in a page's first load and
 * none of it runs with no script; the shell then loads the engine when it
 * is wanted. Until it arrives, a tip control reads the store's blank state
 * and the bar reads the store's balance (`shell/liveBalance.ts`); neither
 * waits on it. If its code cannot load, the figures read unavailable (the
 * balance says so, with Try again, `paymentsStore.retry`) and it tries
 * again (`loadWithBackoff`). It is the only payments shell on a page.
 */
export function DeferredPaymentsShell() {
  const [Shell, setShell] = useState<ComponentType | null>(null)
  useEffect(() => {
    const loading = loadWithBackoff(
      () => shellImport.load(),
      (m) => setShell(() => m.PaymentsShell),
      () => paymentsStore.fail()
    )
    const off = paymentsStore.onRetry(loading.now)
    return () => {
      loading.stop()
      off()
    }
  }, [])
  return Shell ? <Shell /> : null
}
