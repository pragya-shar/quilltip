import { Skeleton } from '@/components/ui/skeleton'
import { NftCardSkeleton } from '@/components/profile/NftCardSkeleton'

export function ProfileNftsTabSkeleton() {
  return (
    <div
      className="profile-nfts"
      role="status"
      aria-label="Loading NFT collections"
    >
      <span className="sr-only">Loading NFT collections…</span>
      {['owned', 'minted'].map((collection) => (
        <div
          key={collection}
          className="profile-nft-collection"
          aria-hidden="true"
        >
          <div className="profile-collection-heading">
            <div className="space-y-3">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-4 w-52 max-w-full" />
            </div>
          </div>
          <div className="profile-nft-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <NftCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
