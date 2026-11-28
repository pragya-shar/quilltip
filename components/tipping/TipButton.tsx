'use client'

import { lazy, Suspense, useEffect } from 'react'
import { TipButtonSkeleton } from '@/components/articles/TipButtonSkeleton'
import type { Id } from '@/convex/_generated/dataModel'
import { clearLegacyTipStorage } from '@/lib/tip/legacyTipStorage'

// The flow loads with import(), so the article page's first load holds none
// of it.
const ArticleTipV2 = lazy(() =>
  import('./v2/ArticleTipV2').then((mod) => ({ default: mod.ArticleTipV2 }))
)

export interface TipButtonProps {
  articleTitle: string
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  className?: string
}

/**
 * The article tip button (payments v2). `ArticleTipActionsInner` renders it
 * only for an article that takes tips; every other state shows a note.
 */
export function TipButton(props: TipButtonProps) {
  useEffect(() => clearLegacyTipStorage(), [])
  return (
    <Suspense fallback={<TipButtonSkeleton />}>
      <ArticleTipV2
        articleId={props.articleId}
        articleTitle={props.articleTitle}
        articleSlug={props.articleSlug}
        authorName={props.authorName}
        className={props.className}
      />
    </Suspense>
  )
}
