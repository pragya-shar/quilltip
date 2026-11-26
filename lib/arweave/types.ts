import type { CanonicalArticle } from '../../convex/lib/chain/ids'

/** Body of an article upload made before canonical article bytes. */
export interface LegacyArweaveArticleContent {
  title: string
  body: unknown // TipTap JSON content
  author: string
  authorId: string
  timestamp: number
  version: number
}

/** An article body on Arweave: canonical article bytes, or the legacy form. */
export type ArweaveArticleContent =
  | CanonicalArticle
  | LegacyArweaveArticleContent

export type ArweaveStatus = 'pending' | 'uploaded' | 'verified' | 'failed'

export interface ArweaveUploadResult {
  success: boolean
  txId?: string
  url?: string
  contentHash?: string
  error?: string
}

export interface ArweaveTransactionStatus {
  confirmed: boolean
  confirmations: number
  blockHeight?: number
}

/** Short tag pairs for Turbo data items (keep values small; full text lives in JSON body). */
export type ArweaveDataTag = { name: string; value: string }
