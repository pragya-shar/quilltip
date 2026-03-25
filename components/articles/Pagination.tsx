'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange?: (page: number) => void
  basePath?: string
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  basePath,
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
    if (basePath && !disabled) {
      return (
        <Link
          href={getPageUrl(page)}
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
        className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="px-3 py-2 text-muted-foreground"
            >
              ...
            </span>
          ) : (
            <PaginationButton
              key={page}
              page={page as number}
              className={`relative inline-flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors border ${
                currentPage === page
                  ? 'z-10 bg-primary text-primary-foreground border-primary'
                  : 'text-foreground bg-card border-border hover:bg-muted'
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
        className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        ariaLabel="Next page"
      >
        <span className="mr-1 hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </PaginationButton>
    </nav>
  )
}
