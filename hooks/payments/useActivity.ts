'use client'

import { usePaymentsRuntime } from '@/lib/payments/runtime'
import type { ActivityView } from '@/lib/payments/types'

/** The signed-in user's tips, newest first: sent as a reader, or received. */
export function useActivity(role: 'reader' | 'writer'): ActivityView {
  return usePaymentsRuntime().useActivity(role)
}
