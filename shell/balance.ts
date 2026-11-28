'use client'

import { createContext, useContext } from 'react'
import type { FigureStatus, MoneyValue } from '@/system/money/figure'

/**
 * What the bar's balance item and the Pocket read: who is here and what they
 * can spend. Provided once by the shell (`BalanceSourceContext`), so the
 * subscription lives in the shell and never remounts between places.
 *
 * Live source: auth from Convex; the amount from `useBalance()` in
 * hooks/payments once pull request 561 is merged. Until then the amount is
 * "unavailable" and the item reads "Pocket". Fixtures and the gallery pass a
 * fake source.
 */
export type BalanceReading = {
  auth: 'loading' | 'signed-out' | 'signed-in'
  /** What a tip can use now. Null until the server answers. */
  available: MoneyValue | null
  status: FigureStatus
}

export type BalanceSource = () => BalanceReading

const signedOut: BalanceReading = {
  auth: 'signed-out',
  available: null,
  status: 'unavailable',
}

export const BalanceSourceContext = createContext<BalanceSource>(
  () => signedOut
)

export function useBalanceReading(): BalanceReading {
  return useContext(BalanceSourceContext)()
}
