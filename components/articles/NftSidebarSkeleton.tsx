import { Skeleton } from '@/components/ui/skeleton'
import '@/components/nft/nft.css'

export function NftSidebarSkeleton() {
  return (
    <div
      className="nft-loading space-y-5"
      role="status"
      aria-label="Loading NFT collection"
    >
      <span className="sr-only">Loading NFT collection</span>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <Skeleton className="h-11 w-full" aria-hidden />
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-1 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
