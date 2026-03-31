'use client'

import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Pagination from '@/components/articles/Pagination'
import { ArticleGridSkeleton } from '@/components/articles/ArticleCardSkeleton'
import { BookOpen } from 'lucide-react'

export function ProfileArticlesTabContent({
  username,
  page,
  basePath,
  isOwnProfile,
  displayName,
}: {
  username: string
  page: number
  basePath: string
  isOwnProfile: boolean
  displayName: string
}) {
  const articlesData = useListArticles({
    author: username,
    page,
    limit: 9,
  })

  if (articlesData === undefined) {
    return <ArticleGridSkeleton count={9} />
  }

  const articles = mapListArticlesToDisplay(articlesData.articles)

  if (articles.length === 0) {
    return (
      <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
        <BookOpen className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
        <p className="text-muted-foreground text-lg">
          {isOwnProfile ? "You haven't" : `${displayName} hasn't`} published any
          articles yet.
        </p>
      </div>
    )
  }

  const totalPages =
    articlesData.totalPages ||
    Math.ceil(articlesData.total / articlesData.limit) ||
    0

  return (
    <>
      <ArticleGrid articles={articles} />

      {totalPages > 1 && (
        <div className="mt-12">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            basePath={basePath}
          />
        </div>
      )}

      <div className="mt-4 text-center text-sm text-muted-foreground">
        Showing {(page - 1) * 9 + 1} - {Math.min(page * 9, articlesData.total)}{' '}
        of {articlesData.total} articles
      </div>
    </>
  )
}
