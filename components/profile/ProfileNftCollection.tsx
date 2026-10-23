import type { ReactNode } from 'react'
import Pagination from '@/components/articles/Pagination'
import { PaginationTransition } from './PaginationTransition'

export function ProfileNftCollection({
  id,
  title,
  description,
  total,
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
  page: number
  pageSize: number
  totalPages: number
  getPageHref: (page: number) => string
  isPaginating: boolean
  children: ReactNode
}) {
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
      {totalPages > 1 && (
        <div className="profile-pagination">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            getPageHref={getPageHref}
          />
        </div>
      )}
      <p className="profile-page-count">
        Showing {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, total)}{' '}
        of {total} NFTs
      </p>
    </section>
  )
}
