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

export const ARWEAVE_STATUSES = [
  'pending',
  'uploaded',
  'verified',
  'failed',
] as const
export type ArweaveStatus = (typeof ARWEAVE_STATUSES)[number]

/** True for a status the storage panel can describe. */
export function isArweaveStatus(
  status: string | null | undefined
): status is ArweaveStatus {
  return (ARWEAVE_STATUSES as readonly string[]).includes(status ?? '')
}

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
