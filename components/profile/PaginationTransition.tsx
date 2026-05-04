'use client'

import { cn } from '@/lib/utils'

export function PaginationTransition({
  isPaginating,
  children,
}: {
  isPaginating: boolean
  children: React.ReactNode
}) {
  return (
    <div
      aria-busy={isPaginating}
      className={cn(
        'transition-opacity duration-200',
        isPaginating && 'animate-pulse opacity-70'
      )}
    >
      {children}
    </div>
  )
}
