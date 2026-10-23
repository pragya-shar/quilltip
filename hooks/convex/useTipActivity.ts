import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useAuth } from '@/components/providers/AuthContext'
import {
  normalizeTipActivity,
  type TipActivityItem,
} from '@/lib/account/tipActivity'

export function useTipActivity():
  | { status: 'loading' }
  | { status: 'ready'; items: TipActivityItem[] } {
  const { user, isLoading, isAuthenticated } = useAuth()
  const args = !isLoading && isAuthenticated && user ? {} : 'skip'
  const sentArticles = useQuery(api.tips.getUserSentTips, args)
  const receivedArticles = useQuery(api.tips.getUserReceivedTips, args)
  const sentPassages = useQuery(api.highlightTips.getByTipper, args)
  const receivedPassages = useQuery(api.highlightTips.getByAuthor, args)
  if (
    args === 'skip' ||
    !user ||
    sentArticles === undefined ||
    receivedArticles === undefined ||
    sentPassages === undefined ||
    receivedPassages === undefined
  )
    return { status: 'loading' }
  // Don't display a previous session's cached query result during an auth transition.
  if (
    [...sentArticles, ...sentPassages].some(
      (tip) => tip.tipperId !== user._id
    ) ||
    [...receivedArticles, ...receivedPassages].some(
      (tip) => tip.authorId !== user._id
    )
  )
    return { status: 'loading' }
  return {
    status: 'ready',
    items: normalizeTipActivity({
      sentArticles,
      receivedArticles,
      sentPassages,
      receivedPassages,
    }).filter((item) => item.articleHref !== null),
  }
}
