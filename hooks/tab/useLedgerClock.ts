'use client'

import { useEffect, useState } from 'react'
import type { LedgerClock, TabServices } from '@/lib/tab-ui/types'

/** How often the latest ledger is re-read (ledgers close about every 5 s). */
export const LEDGER_CLOCK_REFRESH_MS = 60_000

/**
 * The latest ledger and its close time, from Stellar RPC, for key expiry and
 * the withdrawal date. Between reads it advances by elapsed time, as
 * `estimateLedgerTime` does, so it is an estimate.
 */
export function useLedgerClock(services: TabServices): {
  clock: LedgerClock | null
  failed: boolean
} {
  const [clock, setClock] = useState<LedgerClock | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        const next = await services.latestLedger()
        if (!alive) return
        setClock(next)
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    void read()
    const timer = setInterval(read, LEDGER_CLOCK_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [services])
  return { clock, failed }
}
