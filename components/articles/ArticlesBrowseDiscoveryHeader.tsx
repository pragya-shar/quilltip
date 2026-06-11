'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Sparkles, Clock, TrendingUp } from 'lucide-react'
import { useBrowseAuthors, useBrowseTags } from '@/hooks/convex'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'
import {
  BROWSE_SORTS,
  type BrowseSort,
  type BrowseView,
} from '@/lib/articles/browseDiscovery'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import { cn } from '@/lib/utils'

const VIEW_TABS: {
  id: BrowseView
  label: string
  icon: typeof Clock
}[] = [
  { id: 'featured', label: 'Featured', icon: Sparkles },
  { id: 'latest', label: 'Latest', icon: Clock },
  { id: 'trending', label: 'Trending', icon: TrendingUp },
]

const SORT_LABELS: Record<BrowseSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  most_tipped: 'Most tipped',
}

type ArticlesBrowseDiscoveryHeaderProps = {
  view: BrowseView
  sort: BrowseSort
  activeTag?: string
  activeAuthor?: string
}

export function ArticlesBrowseDiscoveryHeader({
  view,
  sort,
  activeTag,
  activeAuthor,
}: ArticlesBrowseDiscoveryHeaderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const browseTags = useBrowseTags()
  const browseAuthors = useBrowseAuthors()

  const handleViewChange = (nextView: BrowseView) => {
    router.push(
      buildArticlesBrowseHref({
        view: nextView,
        page: 1,
        sourceParams: searchParams,
      })
    )
  }

  const handleSortChange = (nextSort: BrowseSort) => {
    router.push(
      buildArticlesBrowseHref({
        sort: nextSort,
        page: 1,
        sourceParams: searchParams,
      })
    )
  }

  const handleAuthorChange = (username: string) => {
    router.push(
      buildArticlesBrowseHref({
        author: username,
        page: 1,
        sourceParams: searchParams,
      })
    )
  }

  const tags = browseTags ?? []
  const authors = browseAuthors ?? []

  return (
    <div className="mb-6 border-b border-border">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="-mb-px flex-1 overflow-x-auto">
          <div
            className="flex min-w-max items-center gap-0.5"
            role="tablist"
            aria-label="Browse articles"
          >
            {VIEW_TABS.map((tab) => {
              const isActive = view === tab.id
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleViewChange(tab.id)}
                  className={cn(
                    'focus-ring inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors min-h-[44px]',
                    isActive
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {tab.label}
                </button>
              )
            })}

            {tags.length > 0 && (
              <>
                <span
                  className="mx-2 h-4 w-px shrink-0 bg-border self-center"
                  aria-hidden
                />
                {tags.map(({ tag }) => (
                  <TagFilterLink
                    key={tag}
                    tag={tag}
                    className={cn(
                      'my-1 shrink-0',
                      activeTag === tag &&
                        'bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                    )}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 pb-3">
          {authors.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Author</span>
              <select
                className="h-9 max-w-[11rem] truncate rounded-md border border-border bg-background px-2 text-foreground sm:max-w-[14rem]"
                value={activeAuthor ?? ''}
                onChange={(e) => handleAuthorChange(e.target.value)}
                aria-label="Filter articles by author"
              >
                <option value="">All authors</option>
                {authors.map((author) => (
                  <option key={author.username} value={author.username}>
                    {author.name?.trim() || `@${author.username}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {view === 'latest' && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Sort by</span>
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-foreground"
                value={sort}
                onChange={(e) => handleSortChange(e.target.value as BrowseSort)}
                aria-label="Sort articles by"
              >
                {BROWSE_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

export function getBrowseContextMessage(
  view: BrowseView,
  browseMeta?: {
    featuredFallback?: boolean
    trendingFallback?: boolean
  }
): string | null {
  if (browseMeta?.featuredFallback) {
    return 'No reader-supported stories yet. Showing recently published articles.'
  }
  if (browseMeta?.trendingFallback) {
    return 'No engagement signals yet. Showing recently published articles.'
  }
  if (view === 'featured') {
    return 'Reader-supported stories with the most tips.'
  }
  if (view === 'trending') {
    return 'Trending by tips and highlights.'
  }
  return null
}
