import type { ReadingRoomRank } from './readingRoomIndex'

export type BrowseView = 'latest' | 'trending' | 'featured'
export type BrowseSort = 'newest' | 'oldest' | 'most_tipped' | 'title'

export type BrowseSortableArticle = {
  title?: string
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
  if (sort === 'title') {
    copy.sort(
      (a, b) =>
        (a.title ?? '').localeCompare(b.title ?? '', 'en', {
          sensitivity: 'base',
        }) || comparePublishedAtDesc(a, b)
    )
    return copy
  }
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

export function normalizeBrowsePage({
  page,
  limit,
}: {
  page?: number
  limit?: number
}) {
  return {
    page: Math.max(page || 1, 1),
    limit: Math.min(Math.max(limit || 10, 1), 50),
  }
}

export function paginateBrowseArticles<T extends BrowseSortableArticle>(
  articles: T[],
  view: BrowseView,
  sort: BrowseSort,
  offset: number,
  limit: number
) {
  const { articles: sorted, meta } = sortArticlesForBrowse(articles, view, sort)
  const total = sorted.length
  const slice = sorted.slice(offset, offset + limit)
  return {
    slice,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    browseMeta: meta,
  }
}

export function paginateReadingRoomMatches(
  rows: ReadingRoomRank[],
  {
    page = 1,
    limit = 10,
    view = 'latest',
    sort = 'newest',
    author,
    bookmarkIds,
  }: {
    page?: number
    limit?: number
    view?: BrowseView
    sort?: BrowseSort
    author?: string
    bookmarkIds?: string[]
  }
) {
  // Stable ties inherit the same order as the original browse source.
  const savedOrder = new Map(
    bookmarkIds?.map((id, index) => [id, index] as const).reverse()
  )
  const ordered = [...rows].sort((a, b) => {
    if (bookmarkIds)
      return (
        (savedOrder.get(a.articleId) ?? 0) - (savedOrder.get(b.articleId) ?? 0)
      )

    const aTag = a.tagOrder
    const bTag = b.tagOrder
    if (aTag && bTag) {
      return (
        bTag.date - aTag.date ||
        bTag.created - aTag.created ||
        bTag.id.localeCompare(aTag.id)
      )
    }
    return (
      (author ? 0 : (b.publishedAt ?? 0) - (a.publishedAt ?? 0)) ||
      b.createdAt - a.createdAt ||
      b.articleId.localeCompare(a.articleId)
    )
  })
  return paginateBrowseArticles(ordered, view, sort, (page - 1) * limit, limit)
}

export function rankReadingRoomWriters(rows: ReadingRoomRank[], limit: number) {
  // The former writer picker broke equal counts by latest published article.
  const newestFirst = [...rows].sort(
    (a, b) =>
      (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity) ||
      b.createdAt - a.createdAt ||
      b.articleId.localeCompare(a.articleId)
  )
  const counts = new Map<
    NonNullable<ReadingRoomRank['writerId']>,
    { articleId: ReadingRoomRank['articleId']; count: number }
  >()
  for (const { writerId, articleId } of newestFirst) {
    if (!writerId) continue
    const writer = counts.get(writerId)
    if (writer) writer.count++
    else counts.set(writerId, { articleId, count: 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ articleId }) => articleId)
}
