// Browser-only collaborators for rendering the real NFT components without
// sending transactions, uploading metadata, or changing a Convex deployment.
import { createContext, useContext, useMemo, useState } from 'react'
import { stellarFlowEmitter } from '../../../lib/stellar/stellar-flow-emitter'

const params = new URLSearchParams(location.search)
export const state = params.get('state') ?? 'owner'
const mode = params.get('mode') ?? 'success'
export const articleTitle =
  'The words we keep: an article about attention and the things that stay with us'
export const api = {
  nfts: { mintNFT: 'mint', transferNFT: 'transfer' },
  nftMetadataUpload: { uploadNftMetadataForMint: 'metadata' },
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 900))
const hold = () => new Promise<never>(() => {})
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

export function useNFTByArticle() {
  if (state === 'loading') return undefined
  return {
    _id: 'qa-nft',
    isMinted: ['owner', 'visitor'].includes(state),
    isEligible: ['eligible', 'unminted-visitor'].includes(state),
    totalTips: state === 'ineligible' ? 250 : 2500,
    tipThreshold: 1000,
    rarity: 'rare',
    mintedAt: 1792756800000,
    owner: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC',
    ownerInfo: { id: 'qa-author', username: 'codex_qa' },
    transferCount: 2,
  }
}
export function useMutation() {
  return async () => {
    if (mode === 'busy') return hold()
    await pause()
    if (mode === 'failure') throw new Error('Recipient not found')
    return 'qa-receipt'
  }
}
export function useAction() {
  return async () => {
    if (mode === 'preparing') return hold()
    await pause()
    return { metadataUrl: 'https://example.com/qa-metadata' }
  }
}
export function useWallet() {
  const [connected, setConnected] = useState(mode !== 'disconnected')
  return {
    isConnected: connected,
    publicKey: connected
      ? 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC'
      : null,
    connect: async () => {
      setConnected(true)
      return true
    },
    signTransaction: async () => {
      if (mode === 'signing') return hold()
      await pause()
      if (mode === 'failure')
        throw new Error('Wallet approval declined. Please try again.')
      return 'signed-qa-xdr'
    },
  }
}
export const useWalletActivation = () => ({ activateWallet: () => {} })
export const stellarClient = { getXLMPrice: async () => 0.2 }
export const nftClient = {
  checkEligibility: async () => ({ eligible: true }),
  buildMintTransaction: async () => ({ xdr: 'qa-xdr' }),
  submitMintTransaction: async () => {
    stellarFlowEmitter.emit({ flow: 'nft_mint', step: 'submitting' })
    await pause()
    stellarFlowEmitter.emit({ flow: 'nft_mint', step: 'confirming' })
    if (mode === 'confirming') return hold()
    await pause()
    return { success: true }
  },
}
export const NO_WALLET_AVAILABLE_ERROR_CODE = 'NO_WALLET'
export const ALBEDO_INSECURE_LOCALHOST_ERROR_CODE = 'INSECURE'
export const InstallWalletDialog = () => null
