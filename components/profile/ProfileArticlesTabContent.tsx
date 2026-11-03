'use client'

import { useListArticles } from '@/hooks/convex'
import { usePaginationTransition } from '@/hooks/usePaginationTransition'
import { articleHref } from '@/lib/library/bookmarks'
import Pagination from '@/components/articles/Pagination'
import { PaginationTransition } from '@/components/profile/PaginationTransition'
import Link from 'next/link'

export function ProfileArticlesTabContent({
  username,
  page,
  isOwnProfile,
  displayName,
}: {
  username: string
  page: number
  isOwnProfile: boolean
  displayName: string
}) {
  const articlesData = useListArticles({ author: username, page, limit: 9 })
  const { data, isPaginating } = usePaginationTransition(articlesData)
  const basePath = `/${encodeURIComponent(username)}`

  if (data === undefined) {
    return <p role="status">Loading articles…</p>
  }

  if (data.total === 0) {
    return (
      <div className="library-empty">
        <p>
          {isOwnProfile ? "You haven't" : `${displayName} hasn't`} published any
          articles yet.
        </p>
        {isOwnProfile && (
          <Link href="/write" className="library-browse">
            Write your first article ↗
          </Link>
        )}
      </div>
    )
  }

  if (data.articles.length === 0) {
    return (
      <div className="library-empty">
        <p>There are no articles on this page.</p>
        <Link href={basePath} className="library-browse">
          Return to the first page
        </Link>
      </div>
    )
  }

  return (
    <PaginationTransition isPaginating={isPaginating}>
      {data.articles.map((article) => {
        const topic = article.tags?.[0]
        return (
          <Link
            className="library-row"
            key={article._id}
            href={articleHref({ username, slug: article.slug })}
            aria-label={`Read more about ${article.title}`}
          >
            <span>
              {(topic || article.readTime) && (
                <small>
                  {[topic, article.readTime && `${article.readTime} min read`]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              )}
              <strong>{article.title}</strong>
              <span>{displayName}</span>
            </span>
            <span aria-hidden>↗</span>
          </Link>
        )
      })}
      <div className="writer-pagination">
        <Pagination
          currentPage={data.page}
          totalPages={data.totalPages}
          basePath={basePath}
        />
      </div>
    </PaginationTransition>
  )
}
