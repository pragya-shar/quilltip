export interface ArweaveArticleContent {
  title: string
  body: unknown // TipTap JSON content
  author: string
  authorId: string
  timestamp: number
  version: number
}

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
