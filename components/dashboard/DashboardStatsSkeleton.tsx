import { Skeleton } from '@/components/ui/skeleton'

export function DashboardStatsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6"
          >
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <Skeleton className="h-9 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
