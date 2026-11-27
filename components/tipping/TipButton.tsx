'use client'

import { lazy, Suspense } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { TipButtonSkeleton } from '@/components/articles/TipButtonSkeleton'
import type { TipButtonProps } from './TipButtonV1'

// Payments v1 until cutover (#451). Each flow loads with import(), so the
// article page's first load holds neither.
const TipButtonV1 = lazy(() =>
  import('./TipButtonV1').then((mod) => ({ default: mod.TipButtonV1 }))
)
const ArticleTipV2 = lazy(() =>
  import('./v2/ArticleTipV2').then((mod) => ({ default: mod.ArticleTipV2 }))
)

/**
 * The article tip button. Renders the v2 flow when the deployment has
 * payments v2 on (`getChainConfig().v2Enabled`), the v1 flow otherwise.
 */
export function TipButton(props: TipButtonProps & { articleSlug?: string }) {
  const config = useQuery(api.chain.config.getChainConfig, {})
  if (config === undefined) return <TipButtonSkeleton />
  return (
    <Suspense fallback={<TipButtonSkeleton />}>
      {config.v2Enabled ? (
        <ArticleTipV2
          articleId={props.articleId}
          articleTitle={props.articleTitle}
          articleSlug={props.articleSlug ?? ''}
          authorName={props.authorName}
          className={props.className}
        />
      ) : (
        <TipButtonV1 {...props} />
      )}
    </Suspense>
  )
}
