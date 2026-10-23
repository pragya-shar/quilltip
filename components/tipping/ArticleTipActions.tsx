'use client'

import { Suspense } from 'react'
import { TipButtonSkeleton } from '@/components/articles/ArticleEngagementSkeleton'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'
import { ArticleTipActionsInner } from '@/components/tipping/ArticleTipActionsInner'

export function ArticleTipActions(props: ArticleTipActionsProps) {
  return (
    <Suspense fallback={<TipButtonSkeleton />}>
      <ArticleTipActionsInner {...props} />
    </Suspense>
  )
}
