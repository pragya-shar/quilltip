'use client'

import { useLayoutEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Pagination from '@/components/articles/Pagination'
import { ArticleGridSkeleton } from '@/components/articles/ArticleCardSkeleton'
import { readBrowseScrollY } from '@/lib/articles/browseListScrollStorage'

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
  scrollStorageKey,
  onArticleNavigate,
}: {
  currentPage: number
  tag?: string
  author?: string
  urlSearch?: string
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
  })

  const listReady = result !== undefined

  useLayoutEffect(() => {
    if (!listReady) return
    const y = readBrowseScrollY(scrollStorageKey)
    if (y === null) return
    window.scrollTo(0, y)
  }, [scrollStorageKey, listReady])

  if (result === undefined) {
    return <ArticleGridSkeleton count={9} />
  }

  const articles = mapListArticlesToDisplay(result.articles)
  const pagination = buildPagination(result)

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('page', page.toString())
    router.push(`/articles?${params.toString()}`)
  }

  return (
    <>
      <ArticleGrid
        articles={articles}
        onArticleNavigate={onArticleNavigate}
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
