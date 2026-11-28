'use client'

import type { ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'

/**
 * Shows the passage tip action, or the paused note while no payment flow can
 * take a tip (`getArticleTipAvailability` returns `paused` or `disabled`).
 * Other states render the action; the v2 button handles them itself.
 */
export function HighlightTipGate({
  articleId,
  children,
}: {
  articleId: Id<'articles'>
  children: ReactNode
}) {
  const availability = useQuery(api.chain.articles.getArticleTipAvailability, {
    articleId,
  })
  // `disabled`: payments v2 is off, so no flow can take the tip.
  if (
    availability?.status === 'paused' ||
    availability?.status === 'disabled'
  ) {
    return <TipsUnavailableNote reason="paused" />
  }
  return <>{children}</>
}
