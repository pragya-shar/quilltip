'use client'

import { useConvex } from 'convex/react'
import { useActivity } from '@/hooks/payments/useActivity'
import { useBalance } from '@/hooks/payments/useBalance'
import { useEarnings } from '@/hooks/payments/useEarnings'
import { formatMoney, formatTokenAmount } from '@/lib/payments/money'
import type { PocketSource } from './source'

/**
 * The balance on the money layer (hooks/payments). Only the balance's own
 * components import this, and they load with the sheet or panel when it
 * opens and with /pocket, never in a public first load. Adding money and
 * withdrawing are not in the money layer yet, so those sheets say what will
 * be possible and offer no action.
 */
export const liveSource: PocketSource = {
  // A backend client is there in the app; not in a page rendered without it.
  useWired: () => Boolean(useConvex()),
  format: {
    money: (cents) => formatMoney(cents),
    token: (baseUnits) => formatTokenAmount(baseUnits),
  },
  useBalance,
  useEarnings,
  useActivity,
  useAddMoney: () => null,
  useWithdraw: () => null,
}
