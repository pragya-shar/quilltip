'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  useNFTsByOwnerPaginated,
  useUserMintedNFTsPaginated,
} from '@/hooks/convex'
import { usePaginationTransition } from '@/hooks/usePaginationTransition'
import type { Id } from '@/types/convex'
import { ProfileNftsTabSkeleton } from '@/components/profile/ProfileNftsTabSkeleton'
import { PaginationTransition } from '@/components/profile/PaginationTransition'
import Pagination from '@/components/articles/Pagination'
import { buildProfileNftPaginationHref } from '@/lib/profile/buildProfileNftPaginationHref'
import { Image, Trophy } from 'lucide-react'

const NFT_PAGE_LIMIT = 9

export function ProfileNftsTabContent({
  userId,
  username,
  nftOwnedPage,
  nftMintedPage,
  isOwnProfile,
  displayName,
}: {
  userId: Id<'users'>
  username: string
  nftOwnedPage: number
  nftMintedPage: number
  isOwnProfile: boolean
  displayName: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false)

  const ownedRaw = useNFTsByOwnerPaginated({
    ownerId: userId,
    page: nftOwnedPage,
    limit: NFT_PAGE_LIMIT,
  })
  const mintedRaw = useUserMintedNFTsPaginated({
    userId,
    page: nftMintedPage,
    limit: NFT_PAGE_LIMIT,
  })

  const owned = usePaginationTransition(ownedRaw)
  const minted = usePaginationTransition(mintedRaw)

  useEffect(() => {
    if (ownedRaw !== undefined && mintedRaw !== undefined) {
      setHasInitiallyLoaded(true)
    }
  }, [ownedRaw, mintedRaw])

  if (
    !hasInitiallyLoaded &&
    (ownedRaw === undefined || mintedRaw === undefined)
  ) {
    return <ProfileNftsTabSkeleton />
  }

  const ownedData = owned.data
  const mintedData = minted.data

  if (ownedData === undefined || mintedData === undefined) {
    return <ProfileNftsTabSkeleton />
  }

  const ownedHref = (p: number) =>
    buildProfileNftPaginationHref(
      pathname || `/${username}`,
      new URLSearchParams(searchParams?.toString() ?? ''),
      'nftOwnedPage',
      p
    )
  const mintedHref = (p: number) =>
    buildProfileNftPaginationHref(
      pathname || `/${username}`,
      new URLSearchParams(searchParams?.toString() ?? ''),
      'nftMintedPage',
      p
    )

  const ownedNfts = ownedData.nfts
  const mintedNfts = mintedData.nfts
  const ownedTotalPages = ownedData.totalPages
  const mintedTotalPages = mintedData.totalPages

  const bothEmpty = ownedData.total === 0 && mintedData.total === 0

  return (
    <div className="space-y-8">
      {ownedData.total > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Owned NFTs
          </h3>
          <PaginationTransition isPaginating={owned.isPaginating}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {ownedNfts.map((nft) => (
                <div
                  key={nft._id}
                  className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
                >
                  <div className="aspect-video bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg mb-4 flex items-center justify-center">
                    <Image className="w-12 h-12 text-white" aria-label="NFT" />
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
          </PaginationTransition>

          {ownedTotalPages > 1 && (
            <div className="mt-12">
              <Pagination
                currentPage={nftOwnedPage}
                totalPages={ownedTotalPages}
                getPageHref={ownedHref}
              />
            </div>
          )}

          {ownedTotalPages > 1 && (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Showing {(nftOwnedPage - 1) * NFT_PAGE_LIMIT + 1} -{' '}
              {Math.min(nftOwnedPage * NFT_PAGE_LIMIT, ownedData.total)} of{' '}
              {ownedData.total} NFTs
            </div>
          )}
        </div>
      )}

      {mintedData.total > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-4">Minted NFTs</h3>
          <PaginationTransition isPaginating={minted.isPaginating}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {mintedNfts.map((nft) => (
                <div
                  key={nft._id}
                  className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
                >
                  <div className="aspect-video bg-gradient-to-br from-blue-400 to-green-400 rounded-lg mb-4 flex items-center justify-center">
                    <Image className="w-12 h-12 text-white" aria-label="NFT" />
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
          </PaginationTransition>

          {mintedTotalPages > 1 && (
            <div className="mt-12">
              <Pagination
                currentPage={nftMintedPage}
                totalPages={mintedTotalPages}
                getPageHref={mintedHref}
              />
            </div>
          )}

          {mintedTotalPages > 1 && (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Showing {(nftMintedPage - 1) * NFT_PAGE_LIMIT + 1} -{' '}
              {Math.min(nftMintedPage * NFT_PAGE_LIMIT, mintedData.total)} of{' '}
              {mintedData.total} NFTs
            </div>
          )}
        </div>
      )}

      {bothEmpty && (
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
          <Image
            className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4"
            aria-label="No NFTs"
          />
          <p className="text-muted-foreground text-lg">
            {isOwnProfile ? "You don't" : `${displayName} doesn't`} have any
            NFTs yet.
          </p>
        </div>
      )}
    </div>
  )
}
