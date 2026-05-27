import { Skeleton } from '@/components/ui/skeleton'

function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6"
        >
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-8 w-20 mb-2" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

function MonthlyChartSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
      <Skeleton className="h-6 w-40 mb-4" />
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="text-center">
            <Skeleton className="h-3 w-full mb-1 mx-auto" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

function TopArticlesListSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
      <div className="p-6 border-b border-border">
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="divide-y divide-border">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 max-w-md" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecentTipsSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
      <div className="p-6 border-b border-border">
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="divide-y divide-border">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <div className="text-right space-y-2 shrink-0">
                <Skeleton className="h-5 w-14 ml-auto" />
                <Skeleton className="h-3 w-20 ml-auto" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EarningsDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <StatCardsSkeleton />
      <MonthlyChartSkeleton />
      <TopArticlesListSkeleton />
      <RecentTipsSkeleton />
    </div>
  )
}
