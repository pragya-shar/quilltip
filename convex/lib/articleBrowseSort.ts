export type BrowseView = 'latest' | 'trending' | 'featured'
export type BrowseSort = 'newest' | 'oldest' | 'most_tipped'

export type BrowseSortableArticle = {
  publishedAt?: number
  tipCount?: number
  highlightCount?: number
}

export type BrowseSortMeta = {
  featuredFallback?: boolean
  trendingFallback?: boolean
}

export function engagementScore(article: BrowseSortableArticle): number {
  return (article.tipCount ?? 0) * 3 + (article.highlightCount ?? 0)
}

function comparePublishedAtDesc(
  a: BrowseSortableArticle,
  b: BrowseSortableArticle
): number {
  return (b.publishedAt ?? 0) - (a.publishedAt ?? 0)
}

function comparePublishedAtAsc(
  a: BrowseSortableArticle,
  b: BrowseSortableArticle
): number {
  return (a.publishedAt ?? 0) - (b.publishedAt ?? 0)
}

function sortByLatest<T extends BrowseSortableArticle>(
  articles: T[],
  sort: BrowseSort
): T[] {
  const copy = [...articles]
  if (sort === 'oldest') {
    copy.sort(comparePublishedAtAsc)
    return copy
  }
  if (sort === 'most_tipped') {
    copy.sort((a, b) => {
      const tipDiff = (b.tipCount ?? 0) - (a.tipCount ?? 0)
      if (tipDiff !== 0) return tipDiff
      return comparePublishedAtDesc(a, b)
    })
    return copy
  }
  copy.sort(comparePublishedAtDesc)
  return copy
}

export function sortArticlesForBrowse<T extends BrowseSortableArticle>(
  articles: T[],
  view: BrowseView,
  sort: BrowseSort
): { articles: T[]; meta: BrowseSortMeta } {
  const meta: BrowseSortMeta = {}

  if (view === 'latest') {
    return { articles: sortByLatest(articles, sort), meta }
  }

  if (view === 'featured') {
    const tipped = articles.filter((a) => (a.tipCount ?? 0) > 0)
    if (tipped.length === 0) {
      meta.featuredFallback = true
      return { articles: sortByLatest(articles, 'newest'), meta }
    }
    const sorted = [...tipped].sort((a, b) => {
      const tipDiff = (b.tipCount ?? 0) - (a.tipCount ?? 0)
      if (tipDiff !== 0) return tipDiff
      return comparePublishedAtDesc(a, b)
    })
    return { articles: sorted, meta }
  }

  const scored = [...articles].sort((a, b) => {
    const scoreDiff = engagementScore(b) - engagementScore(a)
    if (scoreDiff !== 0) return scoreDiff
    return comparePublishedAtDesc(a, b)
  })

  if (scored.every((a) => engagementScore(a) === 0)) {
    meta.trendingFallback = true
    return { articles: sortByLatest(articles, 'newest'), meta }
  }

  return { articles: scored, meta }
}
