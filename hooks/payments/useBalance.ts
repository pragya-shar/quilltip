'use client'

import { usePaymentsRuntime } from '@/lib/payments/runtime'
import type { BalanceView } from '@/lib/payments/types'

/** The signed-in reader's balance: spendable now, pending, device, limits. */
export function useBalance(): BalanceView {
  return usePaymentsRuntime().useBalance()
}
