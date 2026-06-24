import ArticleCard from './ArticleCard'
import ArticleFeedRow from './ArticleFeedRow'
import { ArticleForDisplay } from '@/types/index'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BrowseView } from '@/lib/articles/browseDiscovery'

export type ArticleGridEmptyState = {
  hasSearch: boolean
  hasFilters: boolean
  onClearSearch?: () => void
  onClearAll?: () => void
}

interface ArticleGridProps {
  articles: ArticleForDisplay[]
  variant?: 'home' | 'articles'
  view?: BrowseView
  onArticleNavigate?: () => void
  tagLinkAuthor?: string
  emptyState?: ArticleGridEmptyState
}

export default function ArticleGrid({
  articles,
  variant = 'articles',
  view = 'latest',
  onArticleNavigate,
  tagLinkAuthor,
  emptyState,
}: ArticleGridProps) {
  if (articles.length === 0) {
    if (variant === 'home') {
      return (
        <div className="text-center py-12">
          <div className="max-w-sm mx-auto">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">
              No articles in your feed yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Browse articles or write your first story.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/articles"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
              >
                Browse articles
              </Link>
              <Link
                href="/write"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/80 h-9 px-4 border border-border"
              >
                Write your first article
              </Link>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="text-center py-12">
        <div className="max-w-sm mx-auto rounded-[var(--card-radius)] border border-border bg-card px-6 py-10 shadow-[var(--card-shadow)]">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-1">
            No articles found
          </h3>
          <p className="text-muted-foreground mb-6">
            {emptyState?.hasSearch
              ? 'No articles match your search. Try a different term or clear your search.'
              : "Try adjusting your search or filters to find what you're looking for."}
          </p>
          {emptyState?.hasSearch && emptyState.onClearSearch && (
            <Button type="button" onClick={emptyState.onClearSearch}>
              Clear search
            </Button>
          )}
          {!emptyState?.hasSearch &&
            emptyState?.hasFilters &&
            emptyState.onClearAll && (
              <Button type="button" onClick={emptyState.onClearAll}>
                Clear filters
              </Button>
            )}
        </div>
      </div>
    )
  }

  if (variant === 'articles') {
    return (
      <div className="max-w-3xl mx-auto divide-y divide-border">
        {articles.map((article, index) => (
          <ArticleFeedRow
            key={article.id}
            article={article}
            priority={index === 0}
            onArticleNavigate={onArticleNavigate}
            tagLinkAuthor={tagLinkAuthor}
            view={view}
            isHero={view === 'featured' && index === 0}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {articles.map((article, index) => (
        <ArticleCard
          key={article.id}
          article={article}
          priority={index === 0}
          onArticleNavigate={onArticleNavigate}
          tagLinkAuthor={tagLinkAuthor}
        />
      ))}
    </div>
  )
}
