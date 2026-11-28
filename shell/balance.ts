'use client'

import { createContext, useContext } from 'react'
import type { FigureStatus, MoneyValue } from '@/system/money/figure'

/**
 * What the bar's balance item and the Pocket read: who is here and what they
 * can spend. Provided once by the shell (`BalanceSourceContext`), so the
 * subscription lives in the shell and never remounts between places.
 *
 * Live source (shell/liveBalance.ts): auth from Convex, the amount from the
 * money layer's store. While no amount is known the item reads "Balance".
 * Fixtures and the gallery pass a fake source.
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
