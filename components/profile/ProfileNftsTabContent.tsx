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
import { ProfileNftCollection } from './ProfileNftCollection'
import Link from 'next/link'
import { buildProfileNftPaginationHref } from '@/lib/profile/buildProfileNftPaginationHref'
import { NftCard } from '@/components/nft/NftCard'

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
    <div className="profile-nfts">
      {ownedData.total > 0 && (
        <ProfileNftCollection
          id="owned-nfts"
          title="Owned NFTs"
          description={
            isOwnProfile
              ? 'Articles in your collection.'
              : `Articles in ${displayName}’s collection.`
          }
          total={ownedData.total}
          page={nftOwnedPage}
          pageSize={NFT_PAGE_LIMIT}
          totalPages={ownedTotalPages}
          getPageHref={ownedHref}
          isPaginating={owned.isPaginating}
        >
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
        </ProfileNftCollection>
      )}
      {mintedData.total > 0 && (
        <ProfileNftCollection
          id="minted-nfts"
          title="Minted NFTs"
          description={
            isOwnProfile
              ? 'Articles you brought onchain.'
              : `Articles ${displayName} brought onchain.`
          }
          total={mintedData.total}
          page={nftMintedPage}
          pageSize={NFT_PAGE_LIMIT}
          totalPages={mintedTotalPages}
          getPageHref={mintedHref}
          isPaginating={minted.isPaginating}
        >
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
        </ProfileNftCollection>
      )}
      {bothEmpty && (
        <div className="profile-empty">
          <h2>A collection to come</h2>
          <p>
            {isOwnProfile
              ? 'Articles earn NFTs when they reach the tip threshold. Mint or collect one to see it here.'
              : `${displayName} doesn't have any NFTs yet.`}
          </p>
          {isOwnProfile && (
            <Link href="/articles" className="profile-action">
              Browse articles
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
