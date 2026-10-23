import { Skeleton } from '@/components/ui/skeleton'

export function DashboardHeaderSkeleton() {
  return (
    <div className="mb-8 space-y-2">
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-5 w-96 max-w-full" />
    </div>
  )
}
