// Browser-only collaborators for the profile NFT collections: paginated
// stand-ins for the Convex queries. Nothing reaches a network.
import { createContext, useContext, useMemo } from 'react'

const params = new URLSearchParams(location.search)
export const state = params.get('state') ?? 'profile-pagination'
export const api = {}
export const ProfileNftQueriesContext = createContext({
  owned: { total: 9, resolvedPage: 1 },
  minted: { total: 9, resolvedPage: 1 },
})

function useProfileNftQuery(
  collection: 'owned' | 'minted',
  { page, limit }: { page: number; limit: number }
) {
  const { total, resolvedPage } = useContext(ProfileNftQueriesContext)[
    collection
  ]
  return useMemo(() => {
    if (
      params.get('loading') === '1' ||
      (params.get('controlled') === '1' && page !== resolvedPage)
    )
      return undefined
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      nfts: Array.from(
        { length: Math.max(0, Math.min(limit, total - (page - 1) * limit)) },
        (_, index) => ({
          _id: `qa-nft-${(page - 1) * limit + index}`,
          tokenId: String((page - 1) * limit + index + 1),
          article: {
            title: `Article ${(page - 1) * limit + index + 1}`,
            slug: 'qa-article',
            authorUsername: 'writer',
          },
          minter: { username: 'writer' },
          currentOwnerInfo: { username: 'reader' },
        })
      ),
    }
  }, [page, limit, total, resolvedPage])
}

export const useNFTsByOwnerPaginated = (args: {
  page: number
  limit: number
}) => useProfileNftQuery('owned', args)
export const useUserMintedNFTsPaginated = (args: {
  page: number
  limit: number
}) => useProfileNftQuery('minted', args)
