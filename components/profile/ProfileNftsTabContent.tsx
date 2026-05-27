'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
import { NftCard } from '@/components/nft/NftCard'
import { ImageIcon, Trophy } from 'lucide-react'

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
                <NftCard
                  key={nft._id}
                  title={nft.article?.title || 'Untitled'}
                  slug={nft.article?.slug}
                  authorUsername={nft.article?.authorUsername}
                  coverImage={nft.article?.coverImage}
                  excerpt={nft.article?.excerpt}
                  tokenId={nft.tokenId}
                  footerLabel="Minted by"
                  footerUsername={nft.minter?.username}
                />
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
                <NftCard
                  key={nft._id}
                  title={nft.article?.title || 'Untitled'}
                  slug={nft.article?.slug}
                  authorUsername={nft.article?.authorUsername}
                  coverImage={nft.article?.coverImage}
                  excerpt={nft.article?.excerpt}
                  tokenId={nft.tokenId}
                  footerLabel="Owner"
                  footerUsername={nft.currentOwnerInfo?.username}
                />
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
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-8 sm:p-12 text-center">
          <ImageIcon
            className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4"
            aria-hidden
          />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No NFTs yet
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            {isOwnProfile
              ? 'Articles earn NFTs when they reach the tip threshold. Mint or collect one to see it here.'
              : `${displayName} doesn't have any NFTs yet.`}
          </p>
          {isOwnProfile && (
            <Link
              href="/articles"
              className="focus-ring inline-block mt-6 text-sm font-medium text-brand-blue hover:underline"
            >
              Browse articles
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
