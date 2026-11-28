'use client'

import { usePaymentsRuntime } from '@/lib/payments/runtime'
import type { OwnTipsView } from '@/lib/payments/types'

/**
 * The signed-in reader's own accepted and settled tips on an article, with
 * each tipped passage's text and offsets, so the article can mark the lines
 * this reader tipped. Read while a tip control for the article is on the
 * page; bounded (`complete` is false when there are more).
 */
export function useOwnTips(articleId: string): OwnTipsView {
  return usePaymentsRuntime().useOwnTips(articleId)
}
