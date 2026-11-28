'use client'

import { useMemo, type ReactNode } from 'react'
import { useListArticles } from '@/hooks/convex'
import { usePaginationTransition } from '@/hooks/usePaginationTransition'
import { articleHref } from '@/lib/library/bookmarks'
import Pagination from '@/components/articles/Pagination'
import { PaginationTransition } from '@/components/profile/PaginationTransition'
import Link from 'next/link'
import {
  PROFILE_ARTICLES_PER_PAGE,
  toProfileArticlesPage,
  type ProfileArticlesPage,
} from '@/lib/profile/profileArticles'

export function ProfileArticlesTabContent({
  username,
  page,
  isOwnProfile,
  displayName,
  initialData,
  unavailable,
}: {
  username: string
  page: number
  isOwnProfile: boolean
  displayName: string
  /** The server-rendered first view; live results replace it. */
  initialData?: ProfileArticlesPage
  /** The readable fallback, rendered on the server, when the articles could not be read in time. */
  unavailable?: ReactNode
}) {
  const live = useListArticles({
    author: username,
    page,
    limit: PROFILE_ARTICLES_PER_PAGE,
  })
  const liveRows = useMemo(
    () => (live === undefined ? undefined : toProfileArticlesPage(live)),
    [live]
  )
  const { data, isPaginating } = usePaginationTransition(
    liveRows ?? (initialData?.page === page ? initialData : undefined)
  )
  const basePath = `/${encodeURIComponent(username)}`

  if (data === undefined) {
    return unavailable ? unavailable : <p role="status">Loading articles…</p>
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
            Write your first article <span aria-hidden="true">↗︎</span>
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
        const topic = article.topic
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
            <span className="writer-row-action" aria-hidden>
              Read more <span aria-hidden="true">↗︎</span>
            </span>
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
