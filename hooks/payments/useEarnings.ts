'use client'

import { usePaymentsRuntime } from '@/lib/payments/runtime'
import type { EarningsView } from '@/lib/payments/types'

/** The signed-in writer's pending, available and collected earnings. */
export function useEarnings(): EarningsView {
  return usePaymentsRuntime().useEarnings()
}
