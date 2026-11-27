'use client'

import { usePaymentsRuntime } from '@/lib/payments/runtime'
import type { TipController, TipMeta, TipTarget } from '@/lib/payments/types'

/**
 * The tip control for an article or a passage: the amount it states, the
 * quick amounts, and `tip()`, which sends from the balance at once with no
 * wallet prompt. "Sent" only after the server accepts; no Undo.
 */
export function useTip(target: TipTarget, meta: TipMeta): TipController {
  return usePaymentsRuntime().useTip(target, meta)
}
