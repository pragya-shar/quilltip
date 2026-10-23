'use client'

import { Skeleton } from '@/components/ui/skeleton'

export function RecentWorkListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="px-3 py-3">
          <Skeleton className="mb-2 h-5 w-2/3" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}
