import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

export function useNFTByArticle(articleId: Id<'articles'> | undefined) {
  return useQuery(api.nfts.getNFTByArticle, articleId ? { articleId } : 'skip')
}

export function useNFTsByOwner(ownerId: Id<'users'> | undefined) {
  return useQuery(api.nfts.getNFTsByOwner, ownerId ? { ownerId } : 'skip')
}

export function useUserMintedNFTs(userId: Id<'users'> | undefined) {
  return useQuery(api.nfts.getUserMintedNFTs, userId ? { userId } : 'skip')
}

export type NFTsByOwnerPaginatedArgs = {
  ownerId: Id<'users'>
  page?: number
  limit?: number
}

export function useNFTsByOwnerPaginated(
  args: NFTsByOwnerPaginatedArgs | 'skip'
) {
  return useQuery(
    api.nfts.getNFTsByOwnerPaginated,
    args === 'skip' ? 'skip' : args
  )
}

export type UserMintedNFTsPaginatedArgs = {
  userId: Id<'users'>
  page?: number
  limit?: number
}

export function useUserMintedNFTsPaginated(
  args: UserMintedNFTsPaginatedArgs | 'skip'
) {
  return useQuery(
    api.nfts.getUserMintedNFTsPaginated,
    args === 'skip' ? 'skip' : args
  )
}
