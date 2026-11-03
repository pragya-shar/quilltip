'use client'

import { ArticleTipActions } from '@/components/tipping/ArticleTipActions'
import type { Id } from '@/types/convex'

interface ArticleReaderSupportProps {
  articleTitle: string
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
}

export function ArticleReaderSupport({
  articleTitle,
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
}: ArticleReaderSupportProps) {
  return (
    <div className="reader-support">
      <ArticleTipActions
        articleTitle={articleTitle}
        articleId={articleId}
        articleSlug={articleSlug}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
      />
    </div>
  )
}
