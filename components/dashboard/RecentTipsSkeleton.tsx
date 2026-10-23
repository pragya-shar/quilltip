import { Skeleton } from '@/components/ui/skeleton'

export function RecentTipsSkeleton() {
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
