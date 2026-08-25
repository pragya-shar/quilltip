'use client'

import { useLayoutEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Pagination from '@/components/articles/Pagination'
import { ArticleFeedSkeleton } from '@/components/articles/ArticleFeedSkeleton'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'
import { readBrowseScrollY } from '@/lib/articles/browseListScrollStorage'
import { getBrowseContextMessage } from '@/components/articles/ArticlesBrowseDiscoveryHeader'
import type { BrowseSort, BrowseView } from '@/lib/articles/browseDiscovery'

function buildPagination(result: {
  page: number
  limit: number
  total: number
  totalPages?: number
}) {
  const totalPages =
    result.totalPages || Math.ceil(result.total / result.limit) || 0
  return {
    page: result.page,
    limit: result.limit,
    totalCount: result.total,
    totalPages,
    hasNextPage: result.page < totalPages,
    hasPreviousPage: result.page > 1,
  }
}

export function ArticlesBrowseContent({
  currentPage,
  tag,
  author,
  urlSearch,
  view,
  sort,
  scrollStorageKey,
  onArticleNavigate,
}: {
  currentPage: number
  tag?: string
  author?: string
  urlSearch?: string
  view: BrowseView
  sort: BrowseSort
  scrollStorageKey: string
  onArticleNavigate?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const result = useListArticles({
    page: currentPage,
    limit: 9,
    tag,
    author,
    search: urlSearch,
    view,
    sort,
  })

  const listReady = result !== undefined

  useLayoutEffect(() => {
    if (!listReady) return
    const y = readBrowseScrollY(scrollStorageKey)
    if (y === null) return
    window.scrollTo(0, y)
  }, [scrollStorageKey, listReady])

  if (result === undefined) {
    return <ArticleFeedSkeleton count={6} />
  }

  const articles = mapListArticlesToDisplay(result.articles)
  const pagination = buildPagination(result)
  const contextMessage = getBrowseContextMessage(view, result.browseMeta)

  const handlePageChange = (page: number) => {
    router.push(
      buildArticlesBrowseHref({
        page,
        sourceParams: searchParams,
      })
    )
  }

  const handleClearSearch = () => {
    router.push(
      buildArticlesBrowseHref({
        search: '',
        page: 1,
        sourceParams: searchParams,
      })
    )
  }

  const handleClearAll = () => {
    router.push('/articles')
  }

  const hasSearch = Boolean(urlSearch?.trim())
  const hasFilters = Boolean(tag || author || hasSearch)

  return (
    <>
      {contextMessage && (
        <p className="mb-6 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {contextMessage}
        </p>
      )}

      <ArticleGrid
        articles={articles}
        onArticleNavigate={onArticleNavigate}
        view={view}
        emptyState={{
          hasSearch,
          hasFilters,
          searchTerm: urlSearch?.trim() || undefined,
          activeTag: tag,
          activeAuthor: author,
          onClearSearch: handleClearSearch,
          onClearAll: handleClearAll,
        }}
      />

      {pagination.totalPages > 1 && (
        <div className="mt-12">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}

      {articles.length > 0 && (
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Showing {(pagination.page - 1) * pagination.limit + 1} -{' '}
          {Math.min(pagination.page * pagination.limit, pagination.totalCount)}{' '}
          of {pagination.totalCount} articles
        </div>
      )}
    </>
  )
}
