'use client'

import { lazy, Suspense } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'
import { NftSidebarSkeleton } from '@/components/articles/NftSidebarSkeleton'
import { NFTIntegrationV1 } from './NFTIntegrationV1'
import './nft.css'

export interface NFTIntegrationProps {
  articleId: Id<'articles'>
  articleTitle: string
  articleSlug: string
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  embedded?: boolean
}

// v2 code (the NFT calls, the wallet kit, the payment kit) loads only when
// the article details open on a deployment with v2 on.
const ArticleNftV2 = lazy(() => import('./v2/ArticleNftV2'))

/**
 * The article's NFT section. With payments v2 on (`getChainConfig().v2Enabled`)
 * it shows the v2 NFT; otherwise the v1 panel. v1 code stays until cutover (#451).
 */
export function NFTIntegration(props: NFTIntegrationProps) {
  const config = useQuery(api.chain.config.getChainConfig, {})
  if (config === undefined) return <NftSidebarSkeleton />
  if (config.v2Enabled) {
    return (
      <Suspense fallback={<NftSidebarSkeleton />}>
        <ArticleNftV2
          articleId={props.articleId}
          authorId={props.authorId}
          currentUserId={props.currentUserId}
          embedded={props.embedded}
          renderV1={() => <NFTIntegrationV1 {...props} />}
        />
      </Suspense>
    )
  }
  return <NFTIntegrationV1 {...props} />
}
