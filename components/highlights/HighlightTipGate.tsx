'use client'

import type { ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'

/**
 * Shows the passage tip action, or a note while v1 tips are paused before
 * payments v2 is on (`getArticleTipAvailability` returns `paused`). Other
 * states render the action unchanged.
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
  if (availability?.status === 'paused') {
    return <TipsUnavailableNote reason="paused" />
  }
  return <>{children}</>
}
