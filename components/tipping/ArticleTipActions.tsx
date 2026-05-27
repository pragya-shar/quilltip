'use client'

import { Suspense } from 'react'
import { TipButton } from '@/components/tipping/TipButton'
import { TipButtonSkeleton } from '@/components/articles/ArticleEngagementSkeleton'
import type { Id } from '@/convex/_generated/dataModel'

interface ArticleTipActionsProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
}

function ArticleTipActionsInner({
  articleId,
  articleSlug: _articleSlug,
  authorName,
  authorStellarAddress,
}: ArticleTipActionsProps) {
  return (
    <>
      <TipButton
        articleId={articleId}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
      />
    </>
  )
}

export function ArticleTipActions(props: ArticleTipActionsProps) {
  return (
    <Suspense fallback={<TipButtonSkeleton />}>
      <ArticleTipActionsInner {...props} />
    </Suspense>
  )
}
