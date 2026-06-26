import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

export function DraftsListSkeleton() {
  return (
    <Card variant="quiet" className="divide-y divide-border overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-[var(--workspace-row-padding)]">
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
    </Card>
  )
}
