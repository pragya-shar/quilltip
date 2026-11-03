'use client'

import { TipButton } from '@/components/tipping/TipButton'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'

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
