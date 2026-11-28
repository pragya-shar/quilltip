'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { useConvex } from 'convex/react'
import { paymentsStore } from '@/lib/payments/store'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60_000

/** Loads the payments shell again now, if the balance's own load failed. */
let retryNow: (() => void) | null = null

/** "Try again" on the balance: loads the payments shell again now. */
export function retryPayments() {
  retryNow?.()
}

/**
 * The payments shell for the balance, when no other shell is on the page.
 * The root layout is where the shell belongs (`shell/PaymentsSlot`); until
 * a page has one, the balance mounts its own after it renders, so the
 * sheet, the panel and /pocket read live figures. It loads with the
 * balance, never in a public first load, and does nothing where a shell is
 * already mounted or no backend client exists. If its code cannot load,
 * the figures read unavailable (the balance says so, with Try again) and it
 * tries again after a delay that doubles up to five minutes.
 */
export function LocalPaymentsShell() {
  const client = useConvex()
  const [Shell, setShell] = useState<ComponentType | null>(null)
  useEffect(() => {
    if (!client) return
    let alive = true
    let delay = FIRST_RETRY_MS
    let timer = 0
    const load = () => {
      window.clearTimeout(timer)
      if (!alive || paymentsStore.get().shells > 0) return
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
    retryNow = load
    // After this commit's effects: a shell mounted beside the page has
    // counted itself by then.
    timer = window.setTimeout(load, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
      if (retryNow === load) retryNow = null
    }
  }, [client])
  return Shell ? <Shell /> : null
}
