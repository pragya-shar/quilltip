import { Skeleton } from '@/components/ui/skeleton'

function NftCardSkeleton() {
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

export function ProfileNftsTabSkeleton() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-7 w-40 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <NftCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
