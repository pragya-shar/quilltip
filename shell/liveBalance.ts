'use client'

import { useConvexAuth } from 'convex/react'
import type { BalanceReading } from './balance'

/**
 * The live balance source. Auth comes from Convex now. The amount waits for
 * the money layer (pull request 561): replace the `available` and `status`
 * lines with `useBalance()` from hooks/payments, mapping its `available`
 * and `status` ('ready' → 'ready', 'loading' → 'loading', anything else →
 * 'unavailable').
 */
export function useLiveBalance(): BalanceReading {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const auth = isLoading
    ? 'loading'
    : isAuthenticated
      ? 'signed-in'
      : 'signed-out'
  return { auth, available: null, status: 'unavailable' }
}
