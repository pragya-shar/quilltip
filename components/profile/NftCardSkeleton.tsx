import { Skeleton } from '@/components/ui/skeleton'

export function NftCardSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-3 sm:p-4 min-w-0">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-5 w-3/4 mt-4" />
      <Skeleton className="h-4 w-1/3 mt-2" />
      <Skeleton className="h-4 w-full mt-2" />
      <Skeleton className="h-4 w-1/2 mt-3" />
      <Skeleton className="h-3 w-2/5 mt-2" />
    </div>
  )
}
