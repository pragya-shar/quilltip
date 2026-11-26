'use client'

import { lazy } from 'react'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'

// The tip flow (wallet, Stellar client, dialogs) loads after the page; the
// parent Suspense shows the tip button skeleton until then, as before.
const TipButton = lazy(() =>
  import('@/components/tipping/TipButton').then((mod) => ({
    default: mod.TipButton,
  }))
)

export function ArticleTipActionsInner({
  articleTitle,
  articleId,
  articleSlug: _articleSlug,
  authorName,
  authorStellarAddress,
}: ArticleTipActionsProps) {
  return (
    <>
      <TipButton
        articleTitle={articleTitle}
        articleId={articleId}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
      />
    </>
  )
}
