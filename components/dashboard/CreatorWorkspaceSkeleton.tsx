'use client'

import { Skeleton } from '@/components/ui/skeleton'

export function CreatorWorkspaceSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-8">
        <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)]">
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div>
          <Skeleton className="mb-4 h-6 w-36" />
          <div className="space-y-2 rounded-[var(--card-radius)] border border-border bg-card p-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-36 rounded-[var(--card-radius)]" />
    </div>
  )
}
