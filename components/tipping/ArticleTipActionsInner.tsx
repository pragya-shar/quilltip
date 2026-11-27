'use client'

import { lazy } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { ArticleTipActionsProps } from '@/components/tipping/ArticleTipActionsShared'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'
import { TipButtonSkeleton } from '@/components/articles/TipButtonSkeleton'

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
  articleSlug,
  authorName,
  authorStellarAddress,
}: ArticleTipActionsProps) {
  // With payments v2 on, an article takes tips only once it is registered
  // on Core. With v2 off this is 'disabled' and the v1 flow is unchanged.
  const availability = useQuery(api.chain.articles.getArticleTipAvailability, {
    articleId,
  })
  // Until the answer arrives, show the skeleton rather than a tip button
  // that may turn into a note.
  if (availability === undefined) return <TipButtonSkeleton />
  if (
    availability.status !== 'disabled' &&
    availability.status !== 'registered'
  ) {
    return <TipsUnavailableNote reason={availability.status} />
  }
  return (
    <>
      <TipButton
        articleTitle={articleTitle}
        articleId={articleId}
        articleSlug={articleSlug}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
      />
    </>
  )
}
