'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'

export function TagFilterLink({
  tag,
  author,
  className = '',
  children,
}: {
  tag: string
  author?: string
  className?: string
  children?: React.ReactNode
}) {
  const searchParams = useSearchParams()

  const href = buildArticlesBrowseHref({
    tag,
    page: 1,
    author,
    sourceParams: searchParams,
  })

  return (
    <Link
      href={href}
      aria-label={`Filter by tag ${tag}`}
      className={[
        'focus-ring inline-flex items-center rounded-full',
        'text-xs px-2.5 py-1 bg-muted text-foreground',
        'hover:bg-muted/80 hover:text-foreground',
        'transition-colors',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children ?? tag}
    </Link>
  )
}
