'use client'

import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { paymentsStore } from '@/lib/payments/store'
import { ownTipsViewOf } from '@/lib/payments/views'

/**
 * The signed-in reader's own tips on one article (`activity.mineOnArticle`,
 * caller-only and bounded), written to the store for `useOwnTips`. Mounted
 * by the engine for each article with a tip control on the page.
 */
export function OwnTipsWatch({
  articleId,
  enabled,
}: {
  articleId: Id<'articles'>
  enabled: boolean
}) {
  const read = useQuery(
    api.activity.mineOnArticle,
    enabled ? { articleId } : 'skip'
  )
  useEffect(() => {
    if (read === undefined) return
    const view = ownTipsViewOf(read)
    paymentsStore.set({
      ownTips: { ...paymentsStore.get().ownTips, [articleId]: view },
    })
  }, [read, articleId])
  return null
}
