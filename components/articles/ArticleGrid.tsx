import ArticleCard from './ArticleCard'
import { ArticleForDisplay } from '@/types/index'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'

interface ArticleGridProps {
  articles: ArticleForDisplay[]
  variant?: 'home' | 'articles'
  onArticleNavigate?: () => void
}

export default function ArticleGrid({
  articles,
  variant = 'articles',
  onArticleNavigate,
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
        <div className="max-w-sm mx-auto">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2 2 0 00-2-2h-2"
            />
          </svg>
          <h3 className="text-lg font-medium text-foreground mb-1">
            No articles found
          </h3>
          <p className="text-muted-foreground">
            Try adjusting your search or filters to find what you&apos;re
            looking for.
          </p>
        </div>
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
        />
      ))}
    </div>
  )
}
