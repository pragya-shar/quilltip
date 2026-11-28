'use client'

import { useSyncExternalStore } from 'react'
import { useConvexAuth } from 'convex/react'
import { figuresShown, paymentsStore } from '@/lib/payments/store'
import type { BalanceReading } from './balance'

/** The balance, only while it is held for the user in this session. */
const balanceOf = () => {
  const s = paymentsStore.get()
  return figuresShown(s) ? s.balance : null
}

/**
 * The live balance source. Auth comes from Convex; the amount is the money
 * layer's balance, read from `paymentsStore`: state only, the one payments
 * module a first load may hold, where `useBalance()` would bring the
 * runtime. `ready` and `closing` show the amount; no answer yet, or
 * `loading`, is loading; anything else (including no known price,
 * `available: null`) is unavailable, so the item says "Balance".
 */
export function useLiveBalance(): BalanceReading {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const balance = useSyncExternalStore(
    paymentsStore.subscribe,
    balanceOf,
    () => null
  )
  const auth = isLoading
    ? 'loading'
    : isAuthenticated
      ? 'signed-in'
      : 'signed-out'
  if (auth !== 'signed-in')
    return { auth, available: null, status: 'unavailable' }
  if (!balance || balance.status === 'loading')
    return { auth, available: null, status: 'loading' }
  if (
    (balance.status === 'ready' || balance.status === 'closing') &&
    balance.available
  )
    return { auth, available: balance.available, status: 'ready' }
  return { auth, available: null, status: 'unavailable' }
}
