import type { ReactNode } from 'react'
import Link from 'next/link'
import Pagination from '@/components/articles/Pagination'
import { PaginationTransition } from './PaginationTransition'

export function ProfileNftCollection({
  id,
  title,
  description,
  total,
  displayedCount,
  page,
  pageSize,
  totalPages,
  getPageHref,
  isPaginating,
  children,
}: {
  id: string
  title: string
  description: string
  total: number
  displayedCount: number
  page: number
  pageSize: number
  totalPages: number
  getPageHref: (page: number) => string
  isPaginating: boolean
  children: ReactNode
}) {
  const hasItems = displayedCount > 0
  const rangeStart = (page - 1) * pageSize + 1

  return (
    <section className="profile-nft-collection" aria-labelledby={id}>
      <header className="profile-collection-heading">
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="profile-collection-count">
          {total} {total === 1 ? 'NFT' : 'NFTs'}
        </span>
      </header>
      <PaginationTransition isPaginating={isPaginating}>
        <div className="profile-nft-grid">{children}</div>
      </PaginationTransition>
      {!hasItems && total > 0 && (
        <div className="profile-empty">
          <p>No NFTs on this page. The collection may have changed.</p>
          <Link
            className="profile-action focus-ring"
            href={getPageHref(Math.max(1, totalPages))}
          >
            Go to last available page
          </Link>
        </div>
      )}
      {hasItems && totalPages > 1 && (
        <div className="profile-pagination">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            getPageHref={getPageHref}
          />
        </div>
      )}
      {hasItems && (
        <p className="profile-page-count">
          Showing {rangeStart} –{' '}
          {Math.min(rangeStart + displayedCount - 1, total)} of {total} NFTs
        </p>
      )}
    </section>
  )
}
