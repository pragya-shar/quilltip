import { Skeleton } from '@/components/ui/skeleton'
import '@/components/nft/nft-card.css'

export function NftCardSkeleton() {
  return (
    <div className="nft-card" aria-hidden="true">
      <Skeleton className="nft-card-media rounded-none" />
      <div className="nft-card-copy space-y-4">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <div className="nft-card-details space-y-3">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  )
}
