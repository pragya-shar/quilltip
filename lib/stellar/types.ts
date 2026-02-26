export interface TipData {
  tipId: string
  tipper: string
  amount: number // in stroops
  timestamp: Date
}

export interface TipReceipt {
  tipId: string
  amountSent: number // in stroops
  authorReceived: number // in stroops
  platformFee: number // in stroops
  timestamp: Date
  transactionHash?: string
}

export interface AuthorBalance {
  address: string
  balance: number // in stroops
  balanceXLM: number // in XLM
  balanceUSD: number // in USD
  pendingWithdrawal: boolean
}

export interface TipParams {
  tipper: string
  articleId: string
  authorAddress: string
  amountCents: number
  signerFn?: (txXDR: string) => Promise<string>
}

export interface WithdrawParams {
  authorAddress: string
  signerFn?: (txXDR: string) => Promise<string>
}

export interface StellarWallet {
  publicKey: string
  secretKey?: string // Only for server-side wallets
}

export interface TransactionResult {
  success: boolean
  hash?: string
  error?: string
}

export interface XLMPriceData {
  price: number // USD per XLM
  timestamp: Date
  source: string // Which oracle provided this price (e.g., 'CoinGecko', 'Binance', 'Fallback')
  isFallback: boolean // Whether hardcoded fallback was used
}

// NFT-related types
export interface NFTMetadata {
  name: string // Article title
  description: string // Article excerpt
  image: string // Article cover image URL
  external_url: string // Link back to article
  attributes: {
    author: string // Author username
    tipAmount: number // Tips in stroops when minted
    mintDate: string // ISO date string
    articleSlug: string // Article slug for URL
  }
}

export interface MintNFTParams {
  authorAddress: string // Author's Stellar address
  articleId: string // Article ID (Symbol format for contract)
  tipAmount: number // Current tip amount in stroops
  metadataUrl: string // URL where NFT metadata is stored
}

export interface NFTOwnership {
  tokenId: number // Contract token ID
  owner: string // Current owner address
  minter: string | null // Original minter (null if contract doesn't expose)
  articleId: string | null // Article ID (null if contract doesn't expose)
  mintedAt: Date | null // When it was minted (null if contract doesn't expose)
  tipAmount: number | null // Tips at mint time in stroops (null if contract doesn't expose)
}

export interface NFTTransactionResult {
  success: boolean
  tokenId?: number // Token ID if successful
  transactionHash?: string
  error?: string
}

export interface TipStatistics {
  totalTips: number
  totalVolume: number // in stroops
  totalVolumeUSD: number
  uniqueTippers: number
  topTippedArticles: Array<{
    articleId: string
    totalTips: number
    totalAmount: number
  }>
}
