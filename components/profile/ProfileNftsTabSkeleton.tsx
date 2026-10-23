import { Skeleton } from '@/components/ui/skeleton'
import { NftCardSkeleton } from '@/components/profile/NftCardSkeleton'

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
