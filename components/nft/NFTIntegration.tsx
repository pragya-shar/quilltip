'use client'

import { lazy, Suspense } from 'react'
import type { Id } from '@/types/convex'
import { NftSidebarSkeleton } from '@/components/articles/NftSidebarSkeleton'
import './nft.css'

export interface NFTIntegrationProps {
  articleId: Id<'articles'>
  articleTitle: string
  articleSlug: string
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  embedded?: boolean
}

// The NFT calls, the wallet kit and the payment kit load only when the
// article details open.
const ArticleNftV2 = lazy(() => import('./v2/ArticleNftV2'))

/**
 * The article's NFT section (payments v2). With v2 off or no NFT contract
 * set, `ArticleNftV2` says that NFTs are not available on this site.
 */
export function NFTIntegration(props: NFTIntegrationProps) {
  return (
    <Suspense fallback={<NftSidebarSkeleton />}>
      <ArticleNftV2
        articleId={props.articleId}
        authorId={props.authorId}
        currentUserId={props.currentUserId}
        embedded={props.embedded}
      />
    </Suspense>
  )
}
