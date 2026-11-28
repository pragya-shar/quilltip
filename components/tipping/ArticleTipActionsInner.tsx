'use client'

import { lazy } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'
import { TipButtonSkeleton } from '@/components/articles/TipButtonSkeleton'

// The tip flow (wallet, Stellar RPC, dialogs) loads after the page; the
// parent Suspense shows the tip button skeleton until then.
const TipButton = lazy(() =>
  import('@/components/tipping/TipButton').then((mod) => ({
    default: mod.TipButton,
  }))
)

export function ArticleTipActionsInner({
  articleTitle,
  articleId,
  articleSlug,
  authorName,
}: ArticleTipActionsProps) {
  // An article takes tips only once it is registered on Core. With payments
  // v2 off (`disabled`) no flow can take a tip, so the paused note shows.
  const availability = useQuery(api.chain.articles.getArticleTipAvailability, {
    articleId,
  })
  // Until the answer arrives, show the skeleton rather than a tip button
  // that may turn into a note.
  if (availability === undefined) return <TipButtonSkeleton />
  if (availability.status === 'disabled') {
    return <TipsUnavailableNote reason="paused" />
  }
  if (availability.status !== 'registered') {
    return <TipsUnavailableNote reason={availability.status} />
  }
  return (
    <TipButton
      articleTitle={articleTitle}
      articleId={articleId}
      articleSlug={articleSlug}
      authorName={authorName}
    />
  )
}
