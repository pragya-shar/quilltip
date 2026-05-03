'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange?: (page: number) => void
  basePath?: string
  /** When set, used for Link hrefs instead of `basePath` + `?page=`. */
  getPageHref?: (page: number) => string
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  basePath,
  getPageHref,
}: PaginationProps) {
  const getPageNumbers = () => {
    const pages = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1)
        pages.push('...')
        pages.push(currentPage - 1)
        pages.push(currentPage)
        pages.push(currentPage + 1)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  if (totalPages <= 1) return null

  // Helper function to handle page navigation
  const handlePageChange = (page: number) => {
    if (onPageChange) {
      onPageChange(page)
    }
  }

  // Helper function to get page URL for server-side navigation
  const getPageUrl = (page: number) => {
    if (basePath) {
      return page === 1 ? basePath : `${basePath}?page=${page}`
    }
    return '#'
  }

  const resolveLinkHref = (page: number) => {
    if (getPageHref) return getPageHref(page)
    if (basePath) return getPageUrl(page)
    return null
  }

  // Render button or link based on whether we have onPageChange or basePath
  const PaginationButton = ({
    page,
    disabled = false,
    children,
    className,
    ariaLabel,
  }: {
    page: number
    disabled?: boolean
    children: React.ReactNode
    className: string
    ariaLabel: string
  }) => {
    const linkHref = !disabled ? resolveLinkHref(page) : null
    if (linkHref !== null) {
      return (
        <Link
          href={linkHref}
          className={className}
          aria-label={ariaLabel}
        >
          {children}
        </Link>
      )
    }
    return (
      <button
        onClick={() => !disabled && handlePageChange(page)}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    )
  }

  return (
    <nav
      className="flex items-center justify-center space-x-1"
      aria-label="Pagination"
    >
      {/* Previous Button */}
      <PaginationButton
        page={currentPage - 1}
        disabled={currentPage === 1}
        className="focus-ring relative inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        ariaLabel="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">Previous</span>
      </PaginationButton>

      {/* Page Numbers */}
      <div className="hidden sm:flex space-x-1">
        {getPageNumbers().map((page, index) =>
          page === '...' ? (
            <span
              key={`ellipsis-${index}`}
              className="inline-flex items-center px-3 py-2 text-quill-800 dark:text-foreground/90"
            >
              <span aria-hidden>...</span>
              <span className="sr-only">More pages</span>
            </span>
          ) : (
            <PaginationButton
              key={page}
              page={page as number}
              className={`focus-ring relative inline-flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                currentPage === page
                  ? 'z-10 bg-brand-blue text-white'
                  : 'text-foreground bg-background border border-border hover:bg-muted'
              }`}
              ariaLabel={`Go to page ${page}`}
            >
              {page}
            </PaginationButton>
          )
        )}
      </div>

      {/* Mobile Page Indicator */}
      <div className="flex sm:hidden items-center px-4 py-2 text-sm text-foreground">
        Page {currentPage} of {totalPages}
      </div>

      {/* Next Button */}
      <PaginationButton
        page={currentPage + 1}
        disabled={currentPage === totalPages}
        className="focus-ring relative inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        ariaLabel="Next page"
      >
        <span className="mr-1 hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </PaginationButton>
    </nav>
  )
}
