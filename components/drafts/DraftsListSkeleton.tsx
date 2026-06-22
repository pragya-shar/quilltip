import { Skeleton } from '@/components/ui/skeleton'

export function DraftsListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border ring-1 ring-border/60 p-[var(--card-padding)]"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
            <div className="min-w-0 flex-1 w-full space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-9 w-9 shrink-0 sm:hidden" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="flex flex-wrap gap-4 pt-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="hidden sm:flex gap-2 shrink-0">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
