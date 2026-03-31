'use client'

import { useNFTsByOwner, useUserMintedNFTs } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { Skeleton } from '@/components/ui/skeleton'
import { Image, Trophy } from 'lucide-react'

function ProfileNftsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
          >
            <Skeleton className="aspect-video w-full rounded-lg mb-4" />
            <Skeleton className="h-5 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProfileNftsTabContent({
  userId,
  isOwnProfile,
  displayName,
}: {
  userId: Id<'users'>
  isOwnProfile: boolean
  displayName: string
}) {
  const userNFTs = useNFTsByOwner(userId)
  const mintedNFTs = useUserMintedNFTs(userId)

  if (userNFTs === undefined || mintedNFTs === undefined) {
    return <ProfileNftsSkeleton />
  }

  return (
    <div className="space-y-8">
      {userNFTs.length > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Owned NFTs
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {userNFTs.map((nft) => (
              <div
                key={nft._id}
                className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
              >
                <div className="aspect-video bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg mb-4 flex items-center justify-center">
                  <Image
                    className="w-12 h-12 text-white"
                    aria-label="NFT"
                  />
                </div>
                <h4 className="font-semibold text-foreground truncate">
                  {nft.article?.title || 'Untitled'}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Token ID: {nft.tokenId.slice(0, 8)}...
                </p>
                <p className="text-xs text-muted-foreground/80 mt-2">
                  Minted by @{nft.minter?.username || 'unknown'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {mintedNFTs.length > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-4">Minted NFTs</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mintedNFTs.map((nft) => (
              <div
                key={nft._id}
                className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
              >
                <div className="aspect-video bg-gradient-to-br from-blue-400 to-green-400 rounded-lg mb-4 flex items-center justify-center">
                  <Image
                    className="w-12 h-12 text-white"
                    aria-label="NFT"
                  />
                </div>
                <h4 className="font-semibold text-foreground truncate">
                  {nft.article?.title || 'Untitled'}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Token ID: {nft.tokenId.slice(0, 8)}...
                </p>
                <p className="text-xs text-muted-foreground/80 mt-2">
                  Owner: @{nft.currentOwnerInfo?.username || 'unknown'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {userNFTs.length === 0 && mintedNFTs.length === 0 && (
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
          <Image
            className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4"
            aria-label="No NFTs"
          />
          <p className="text-muted-foreground text-lg">
            {isOwnProfile
              ? "You don't"
              : `${displayName} doesn't`}{' '}
            have any NFTs yet.
          </p>
        </div>
      )}
    </div>
  )
}
