import ArticleCard from './ArticleCard'
import ArticleFeedRow from './ArticleFeedRow'
import { ArticleForDisplay } from '@/types/index'
import { BookOpen } from 'lucide-react'
import { RouteEmptyState } from '@/components/ui/route-empty-state'
import type { BrowseView } from '@/lib/articles/browseDiscovery'

export type ArticleGridEmptyState = {
  hasSearch: boolean
  hasFilters: boolean
  searchTerm?: string
  activeTag?: string
  activeAuthor?: string
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

function getBrowseEmptyContent(emptyState?: ArticleGridEmptyState): {
  title: string
  description: string
  primaryLabel: string
  onPrimary: (() => void) | undefined
  primaryHref: string | undefined
} {
  const hasSearch = Boolean(emptyState?.hasSearch)
  const hasTagOrAuthor = Boolean(
    emptyState?.activeTag?.trim() || emptyState?.activeAuthor?.trim()
  )
  const searchTerm = emptyState?.searchTerm?.trim() ?? ''

  if (hasSearch && hasTagOrAuthor) {
    const filterParts = [
      emptyState?.activeTag ? `tag "${emptyState.activeTag}"` : null,
      emptyState?.activeAuthor ? `author "${emptyState.activeAuthor}"` : null,
    ].filter(Boolean)
    return {
      title: `No results for "${searchTerm}"`,
      description: `No articles match your search with ${filterParts.join(' and ')}. Try another term or clear everything.`,
      primaryLabel: 'Clear all',
      onPrimary: emptyState?.onClearAll,
      primaryHref: undefined,
    }
  }

  if (hasSearch) {
    return {
      title: `No results for "${searchTerm}"`,
      description: 'Try a different term or clear your search.',
      primaryLabel: 'Clear search',
      onPrimary: emptyState?.onClearSearch,
      primaryHref: undefined,
    }
  }

  if (hasTagOrAuthor) {
    const filterParts = [
      emptyState?.activeTag ? `tag "${emptyState.activeTag}"` : null,
      emptyState?.activeAuthor ? `author "${emptyState.activeAuthor}"` : null,
    ].filter(Boolean)
    return {
      title: 'No articles match these filters',
      description: `No articles found for ${filterParts.join(' and ')}. Try different filters or clear them.`,
      primaryLabel: 'Clear filters',
      onPrimary: emptyState?.onClearAll,
      primaryHref: undefined,
    }
  }

  return {
    title: 'No articles yet',
    description: 'Check back soon for new stories from writers on Quilltip.',
    primaryLabel: 'Browse latest',
    onPrimary: undefined,
    primaryHref: '/articles',
  }
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
          <RouteEmptyState
            icon={BookOpen}
            title="No articles in your feed yet"
            description="Write your first story or browse what others have published."
            action={{ label: 'Write your first article', href: '/write' }}
            secondaryAction={{ label: 'Browse articles', href: '/articles' }}
          />
        </div>
      )
    }

    const browseEmpty = getBrowseEmptyContent(emptyState)
    return (
      <div className="text-center py-12">
        <RouteEmptyState
          icon={BookOpen}
          title={browseEmpty.title}
          description={browseEmpty.description}
          action={
            browseEmpty.onPrimary
              ? { label: browseEmpty.primaryLabel, onClick: browseEmpty.onPrimary }
              : browseEmpty.primaryHref
                ? { label: browseEmpty.primaryLabel, href: browseEmpty.primaryHref }
                : undefined
          }
        />
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
