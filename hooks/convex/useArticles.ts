import { usePaginatedQuery, useQueries, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import {
  normalizeBrowsePage,
  paginateReadingRoomMatches,
} from '@/convex/lib/articleBrowseSort'
import {
  READING_ROOM_HYDRATION_SIZE,
  READING_ROOM_SCAN_SIZE,
} from '@/lib/articles/readingRoomSearchBatch'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

import type {
  BrowseSort,
  BrowseView,
  ReadingRoomCategory,
} from '@/lib/articles/browseDiscovery'

export type ListArticlesArgs = {
  page?: number
  limit?: number
  tag?: string
  author?: string
  search?: string
  view?: BrowseView
  category?: ReadingRoomCategory
  bookmarkIds?: string[]
  searchByWriterOrTitle?: boolean
  sort?: BrowseSort
}

export function useListArticles(args: ListArticlesArgs | 'skip') {
  return useQuery(api.articles.listArticles, args === 'skip' ? 'skip' : args)
}

export function useReadingRoomArticles(args: ListArticlesArgs | 'skip') {
  const filters =
    args !== 'skip' && args.search?.trim()
      ? {
          search: args.search,
          author: args.author,
          tag: args.tag,
          category: args.category,
          bookmarkIds: args.bookmarkIds,
        }
      : null
  // An empty bookmark request works with both deployed API versions and reads
  // no articles. Wait for it before selecting the search protocol.
  const capability = useListArticles(filters ? { bookmarkIds: [] } : 'skip')
  const result = useQuery(
    api.articles.listArticles,
    args === 'skip' || (filters && capability === undefined)
      ? 'skip'
      : capability && 'supportsSearchScan' in capability
        ? { ...args, allowSearchScan: true }
        : args
  )
  const key = filters && JSON.stringify(filters)
  const [scanKey, setScanKey] = useState<string | null>(null)
  const requiresScan = !!(
    result &&
    'scanRequired' in result &&
    result.scanRequired
  )
  // Keep the scan subscriptions while a new page or sort loads for the same filters.
  const nextScanKey = result ? (requiresScan ? key : null) : scanKey
  if (scanKey !== nextScanKey) setScanKey(nextScanKey)
  const scan = filters && (requiresScan || (!result && scanKey === key))
  const { results, status, loadMore } = usePaginatedQuery(
    api.articles.scanReadingRoomSearch,
    scan ? filters : 'skip',
    { initialNumItems: READING_ROOM_SCAN_SIZE }
  )
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(READING_ROOM_SCAN_SIZE)
  }, [status, loadMore])

  const browse = args === 'skip' ? {} : args
  const { page, limit } = normalizeBrowsePage(browse)
  const { author, bookmarkIds, view, sort } = browse
  const ranked = useMemo(
    () =>
      scan && status === 'Exhausted'
        ? paginateReadingRoomMatches(results, {
            page,
            limit,
            author,
            bookmarkIds,
            view,
            sort,
          })
        : undefined,
    [scan, status, results, page, limit, author, bookmarkIds, view, sort]
  )

  const hydration = useMemo(() => {
    const queries: Record<
      string,
      {
        query: typeof api.articles.loadReadingRoomSearchPage
        args: { ids: Id<'articles'>[] }
      }
    > = {}
    const ids = ranked?.slice.map(({ articleId }) => articleId) ?? []
    for (let i = 0; i < ids.length; i += READING_ROOM_HYDRATION_SIZE) {
      queries[i] = {
        query: api.articles.loadReadingRoomSearchPage,
        args: { ids: ids.slice(i, i + READING_ROOM_HYDRATION_SIZE) },
      }
    }
    return queries
  }, [ranked])
  const hydrated = useQueries(hydration)
  if (!scan) return result
  if (!ranked) return undefined

  const articles = []
  for (const key of Object.keys(hydration)) {
    const batch = hydrated[key]
    if (batch instanceof Error) throw batch
    if (batch === undefined) return undefined
    articles.push(...batch)
  }
  return {
    articles,
    total: ranked.total,
    totalPages: ranked.totalPages,
    browseMeta: ranked.browseMeta,
    page,
    limit,
  }
}

export function useBrowseTags(limit = 12) {
  return useQuery(api.articles.listBrowseTags, { limit })
}

export function useBrowseAuthors(limit: number | 'skip' = 20) {
  return useQuery(
    api.articles.listBrowseAuthors,
    limit === 'skip' ? 'skip' : { limit }
  )
}

export function useArticleBySlug(
  username: string | null | undefined,
  slug: string | null | undefined
) {
  return useQuery(
    api.articles.getArticleBySlug,
    username && slug ? { username, slug } : 'skip'
  )
}

export function useArticleById(articleId: Id<'articles'> | undefined) {
  return useQuery(
    api.articles.getArticleById,
    articleId ? { id: articleId } : 'skip'
  )
}

export function useUserDrafts() {
  return useQuery(api.articles.getUserDrafts)
}

export type CreatorRecentWorkArgs = {
  limit?: number
}

export function useCreatorRecentWork(args: CreatorRecentWorkArgs = {}) {
  return useQuery(api.articles.getCreatorRecentWork, args)
}

export function useCreatorWorkspaceSummary() {
  return useQuery(api.articles.getCreatorWorkspaceSummary)
}

export function useReadNextArticles(articleId: Id<'articles'> | undefined) {
  return useQuery(
    api.articles.getReadNextArticles,
    articleId ? { articleId } : 'skip'
  )
}
