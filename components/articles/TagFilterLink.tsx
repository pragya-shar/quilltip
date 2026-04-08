'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export function TagFilterLink({
  tag,
  className = '',
  children,
}: {
  tag: string
  className?: string
  children?: React.ReactNode
}) {
  const searchParams = useSearchParams()

  const params = new URLSearchParams(searchParams?.toString() || '')
  params.set('tag', tag)
  params.set('page', '1')

  const href = `/articles?${params.toString()}`

  return (
    <Link
      href={href}
      aria-label={`Filter by tag ${tag}`}
      className={[
        'focus-ring inline-flex items-center rounded-full',
        'text-xs px-2 py-1 bg-muted text-foreground',
        'hover:bg-muted/80 hover:text-foreground',
        'transition-colors',
        className,
      ].join(' ')}
    >
      {children ?? tag}
    </Link>
  )
}
