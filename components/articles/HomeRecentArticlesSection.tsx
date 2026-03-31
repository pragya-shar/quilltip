'use client'

import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import ArticleGrid from '@/components/articles/ArticleGrid'
import { ArticleGridSkeleton } from '@/components/articles/ArticleCardSkeleton'

/**
 * Recent articles for the authenticated home dashboard. Uses Convex useQuery
 * (not use() + convex.query) because Next.js requires cached promises for use()
 * in Client Components.
 */
export function HomeRecentArticlesSection() {
  const result = useListArticles({ limit: 6 })

  if (result === undefined) {
    return <ArticleGridSkeleton count={6} />
  }

  const recentArticles = mapListArticlesToDisplay(result.articles)
  return <ArticleGrid articles={recentArticles} variant="home" />
}
