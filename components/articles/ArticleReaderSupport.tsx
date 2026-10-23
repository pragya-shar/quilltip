'use client'

import { ArticleTipActions } from '@/components/tipping/ArticleTipActions'
import { TipStats } from '@/components/tipping/TipStats'
import type { Id } from '@/types/convex'

interface ArticleReaderSupportProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
}

export function ArticleReaderSupport({
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
}: ArticleReaderSupportProps) {
  return (
    <div className="reader-support">
      <ArticleTipActions
        articleId={articleId}
        articleSlug={articleSlug}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
      />
      <TipStats articleId={articleId} />
    </div>
  )
}
