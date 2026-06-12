import type { BrowseView } from '@/lib/articles/browseDiscovery'

type FeedRowArticle = {
  tipCount?: number
  highlightCount?: number
}

export function getFeedRowContextLabel(
  view: BrowseView,
  article: FeedRowArticle
): string | null {
  const tipCount = article.tipCount ?? 0
  const highlightCount = article.highlightCount ?? 0

  if (view === 'featured' && tipCount > 0) {
    return 'Reader-supported'
  }

  if (view === 'trending') {
    const engagement = tipCount * 3 + highlightCount
    if (engagement > 0) {
      return 'Trending'
    }
  }

  return null
}

/** @deprecated Use getFeedRowContextLabel */
export function getFeedRowStatusLabel(
  view: BrowseView,
  article: FeedRowArticle
): string | null {
  return getFeedRowContextLabel(view, article)
}

export function formatReadTime(minutes?: number): string | null {
  if (!minutes || minutes < 1) return null
  return `${minutes} min read`
}
