import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

export function useArticleHighlightsQuery(
  articleId: Id<'articles'> | undefined,
  enabled = true
) {
  return useQuery(
    api.highlights.getArticleHighlights,
    enabled && articleId ? { articleId } : 'skip'
  )
}

export function useUserHighlightsQuery(userId: Id<'users'> | undefined) {
  return useQuery(
    api.highlights.getUserHighlights,
    userId ? { userId } : 'skip'
  )
}

export function useHighlightTipsByHighlight(highlightId: string) {
  return useQuery(api.highlightTips.getByHighlight, { highlightId })
}

export function useArticleHighlightTipStats(
  articleId: Id<'articles'>,
  opts?: { sinceMs?: number }
) {
  return useQuery(api.highlightTips.getArticleStats, {
    articleId,
    sinceMs: opts?.sinceMs,
  })
}

export function useArticleHighlightTipStatsOptional(
  articleId: Id<'articles'> | undefined,
  opts?: { sinceMs?: number }
) {
  return useQuery(
    api.highlightTips.getArticleStats,
    articleId
      ? {
          articleId,
          sinceMs: opts?.sinceMs,
        }
      : 'skip'
  )
}
