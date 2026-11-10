import { usePaginatedQuery, useQueries, useQuery } from 'convex/react'
import type { FunctionArgs, FunctionReference } from 'convex/server'
import { useEffect, useMemo, useState } from 'react'
import {
  normalizeBrowsePage,
  paginateReadingRoomMatches,
  rankReadingRoomWriters,
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

function useReadingRoomSearchSupport(enabled: boolean) {
  // An empty bookmark request works with both deployed API versions and reads
  // no articles. Wait for it before selecting the search protocol.
  const capability = useListArticles(enabled ? { bookmarkIds: [] } : 'skip')
  return capability && 'supportsSearchScan' in capability
}

type ScanFilters = Omit<
  FunctionArgs<typeof api.articles.scanReadingRoomSearch>,
  'paginationOpts'
>

function useCompleteReadingRoomScan(filters: ScanFilters | 'skip') {
  const { results, status, loadMore } = usePaginatedQuery(
    api.articles.scanReadingRoomSearch,
    filters,
    { initialNumItems: READING_ROOM_SCAN_SIZE }
  )
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(READING_ROOM_SCAN_SIZE)
  }, [status, loadMore])
  return status === 'Exhausted' ? results : undefined
}

const readingRoomArticlePageQuery = api.articles.loadReadingRoomSearchPage
const readingRoomWriterOptionsQuery = api.articles.loadReadingRoomWriterOptions

function useReadingRoomBatches<Row>(
  query: FunctionReference<'query', 'public', { ids: Id<'articles'>[] }, Row[]>,
  ids: Id<'articles'>[] | undefined
) {
  const queries = useMemo(() => {
    const batches: Record<
      string,
      { query: typeof query; args: { ids: Id<'articles'>[] } }
    > = {}
    if (!ids) return batches
    for (let i = 0; i < ids.length; i += READING_ROOM_HYDRATION_SIZE) {
      batches[i] = {
        query,
        args: { ids: ids.slice(i, i + READING_ROOM_HYDRATION_SIZE) },
      }
    }
    return batches
  }, [ids, query])
  const hydrated = useQueries(queries)
  if (!ids) return undefined

  const rows: Row[] = []
  for (const key of Object.keys(queries)) {
    const batch = hydrated[key]
    if (batch instanceof Error) throw batch
    if (batch === undefined) return undefined
    rows.push(...batch)
  }
  return rows
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
  const supportsScan = useReadingRoomSearchSupport(!!filters)
  const result = useQuery(
    api.articles.listArticles,
    args === 'skip' || (filters && supportsScan === undefined)
      ? 'skip'
      : supportsScan
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
  const nextScanKey =
    !supportsScan || (result && !requiresScan)
      ? null
      : requiresScan
        ? key
        : scanKey
  if (scanKey !== nextScanKey) setScanKey(nextScanKey)
  const scan =
    supportsScan && filters && (requiresScan || (!result && scanKey === key))
  const results = useCompleteReadingRoomScan(scan ? filters : 'skip')

  const browse = args === 'skip' ? {} : args
  const { page, limit } = normalizeBrowsePage(browse)
  const { author, bookmarkIds, view, sort } = browse
  const ranked = useMemo(
    () =>
      results
        ? paginateReadingRoomMatches(results, {
            page,
            limit,
            author,
            bookmarkIds,
            view,
            sort,
          })
        : undefined,
    [results, page, limit, author, bookmarkIds, view, sort]
  )

  const ids = useMemo(
    () => ranked?.slice.map(({ articleId }) => articleId),
    [ranked]
  )
  const articles = useReadingRoomBatches(readingRoomArticlePageQuery, ids)
  if (!scan) return result
  if (!ranked || !articles) return undefined
  return {
    articles,
    total: ranked.total,
    totalPages: ranked.totalPages,
    browseMeta: ranked.browseMeta,
    page,
    limit,
  }
}

export function useReadingRoomWriterOptions(enabled: boolean) {
  const supportsScan = useReadingRoomSearchSupport(enabled)
  const legacy = useBrowseAuthors(
    enabled && supportsScan === false ? 20 : 'skip'
  )
  const rows = useCompleteReadingRoomScan(enabled && supportsScan ? {} : 'skip')
  const ids = useMemo(() => rows && rankReadingRoomWriters(rows, 20), [rows])
  const writers = useReadingRoomBatches(readingRoomWriterOptionsQuery, ids)
  return supportsScan ? writers : legacy
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
