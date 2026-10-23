'use client'

import { TipButton } from '@/components/tipping/TipButton'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'

export function ArticleTipActionsInner({
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
