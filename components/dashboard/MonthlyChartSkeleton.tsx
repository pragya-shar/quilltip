import { Skeleton } from '@/components/ui/skeleton'

export function MonthlyChartSkeleton() {
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
