import { Skeleton } from '@/components/ui/skeleton'

export function DashboardTabBarSkeleton() {
  return (
    <div className="min-w-0 w-full overflow-hidden border-b border-border mb-8">
      <div className="-mb-px flex flex-nowrap gap-4 sm:gap-8 pb-0.5">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-24 shrink-0" />
        ))}
      </div>
    </div>
  )
}
