'use client'

import { useListArticles } from '@/hooks/convex'
import { usePaginationTransition } from '@/hooks/usePaginationTransition'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import { ReadingRoomCard } from '@/components/articles/ReadingRoomCard'
import { useRouter } from 'next/navigation'
import Pagination from '@/components/articles/Pagination'
import { ProfileArticlesSkeleton } from './ProfileArticlesSkeleton'
import { PaginationTransition } from '@/components/profile/PaginationTransition'
import Link from 'next/link'

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
  const router = useRouter()
  const articlesData = useListArticles({
    author: username,
    page,
    limit: 9,
  })

  const { data, isPaginating } = usePaginationTransition(articlesData)

  if (data === undefined) {
    return <ProfileArticlesSkeleton />
  }

  const articles = mapListArticlesToDisplay(data.articles)

  if (articles.length === 0) {
    return (
      <div className="profile-empty">
        <h2>Articles to come</h2>
        <p>
          {isOwnProfile ? "You haven't" : `${displayName} hasn't`} published any
          articles yet.
        </p>
        {isOwnProfile && (
          <Link href="/write" className="profile-action">
            Write your first article
          </Link>
        )}
      </div>
    )
  }

  const totalPages = data.totalPages || Math.ceil(data.total / data.limit) || 0

  return (
    <div className="reading-room profile-publications">
      <PaginationTransition isPaginating={isPaginating}>
        <div className="shelf">
          {articles.map((article, index) => (
            <ReadingRoomCard
              key={article.id}
              article={article}
              index={index}
              onNavigate={() => {}}
              onAuthor={(author) => router.push(`/${author}`)}
              tagLinkAuthor={username}
            />
          ))}
        </div>
      </PaginationTransition>

      {totalPages > 1 && (
        <div className="profile-pagination">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            basePath={basePath}
          />
        </div>
      )}

      <div className="profile-page-count">
        Showing {(page - 1) * 9 + 1} - {Math.min(page * 9, data.total)} of{' '}
        {data.total} articles
      </div>
    </div>
  )
}
