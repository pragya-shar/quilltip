'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { useConvex } from 'convex/react'
import { paymentsStore } from '@/lib/payments/store'

/**
 * The payments shell for the balance, when no other shell is on the page.
 * The root layout is where the shell belongs (`shell/PaymentsSlot`); until
 * a page has one, the balance mounts its own after it renders, so the
 * sheet, the panel and /pocket read live figures. It loads with the
 * balance, never in a public first load, and does nothing where a shell is
 * already mounted or no backend client exists.
 */
export function LocalPaymentsShell() {
  const client = useConvex()
  const [Shell, setShell] = useState<ComponentType | null>(null)
  useEffect(() => {
    if (!client) return
    let alive = true
    // After this commit's effects: a shell mounted beside the page has
    // counted itself by then.
    const id = window.setTimeout(() => {
      if (!alive || paymentsStore.get().shells > 0) return
      import('@/components/payments/PaymentsShell')
        .then((m) => alive && setShell(() => m.PaymentsShell))
        .catch(() => {})
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [client])
  return Shell ? <Shell /> : null
}
