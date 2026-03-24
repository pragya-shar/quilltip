import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

export function useArticleTipStats(articleId: Id<'articles'>) {
  return useQuery(api.tips.getArticleTipStats, { articleId })
}

export function useAuthorEarnings() {
  return useQuery(api.tips.getAuthorEarnings, {})
}

export function useUserReceivedTips() {
  return useQuery(api.tips.getUserReceivedTips, {})
}
