import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY =
  'quilltip:pendingArticleTipReceipts'
const STORAGE_FAILURE_MESSAGE =
  'Your signed tip could not be saved for safe recovery. No transaction was sent. Free browser storage or allow site storage, then retry.'

const pendingArticleTipReceiptSchema = z.object({
  articleId: z.string().min(1),
  tipperId: z.string().min(1),
  amountCents: z.number().int().positive(),
  message: z.string().max(500).optional(),
  stellarNetwork: z.union([z.literal('TESTNET'), z.literal('MAINNET')]),
  stellarSourceAccount: z.string().min(1),
  intentId: z.string().min(1),
  signedXdr: z.string().min(1),
  stellarTxId: z.string().min(1),
  stellarLedger: z.number().int().positive().optional(),
  stellarFeeCharged: z.string().optional(),
  contractTipId: z.string().optional(),
  submittedTipId: z.string().min(1).optional(),
})

const pendingArticleTipReceiptsSchema = z
  .array(pendingArticleTipReceiptSchema)
  .max(20)

type StoredPendingArticleTipReceipt = z.infer<
  typeof pendingArticleTipReceiptSchema
>

export type PendingArticleTipReceipt = Omit<
  StoredPendingArticleTipReceipt,
  'tipperId' | 'intentId' | 'submittedTipId'
> & {
  tipperId: Id<'users'>
  intentId: Id<'articleTipIntents'>
  submittedTipId?: Id<'tips'>
}

let memoryReceipts: PendingArticleTipReceipt[] = []

function receiptMatches(
  receipt: PendingArticleTipReceipt,
  articleId: Id<'articles'> | string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): boolean {
  return (
    receipt.articleId === String(articleId) &&
    receipt.stellarNetwork === stellarNetwork &&
    receipt.tipperId === String(tipperId)
  )
}

function readReceipts(): PendingArticleTipReceipt[] {
  if (typeof window === 'undefined') return memoryReceipts

  try {
    const raw = window.localStorage.getItem(
      PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY
    )
    if (raw === null) {
      memoryReceipts = []
      return memoryReceipts
    }

    const parsed: unknown = JSON.parse(raw)
    const result = pendingArticleTipReceiptsSchema.safeParse(parsed)
    if (!result.success) return memoryReceipts

    memoryReceipts = result.data as PendingArticleTipReceipt[]
  } catch {
    // localStorage can be unavailable in private browsing or restricted frames.
  }

  return memoryReceipts
}

function persistReceipts(
  receipts: PendingArticleTipReceipt[],
  requireDurableWrite: boolean
): void {
  if (typeof window === 'undefined') {
    if (requireDurableWrite) throw new Error(STORAGE_FAILURE_MESSAGE)
    memoryReceipts = receipts
    return
  }

  const serialized = JSON.stringify(receipts)
  try {
    window.localStorage.setItem(
      PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY,
      serialized
    )
    if (
      requireDurableWrite &&
      window.localStorage.getItem(PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY) !==
        serialized
    ) {
      throw new Error('durability check failed')
    }
  } catch {
    if (requireDurableWrite) throw new Error(STORAGE_FAILURE_MESSAGE)
    return
  }
  memoryReceipts = receipts
}

export function writePendingArticleTipReceipt(
  receipt: PendingArticleTipReceipt
): void {
  const normalized: PendingArticleTipReceipt = {
    ...receipt,
    articleId: String(receipt.articleId),
  }
  const remaining = readReceipts().filter(
    (candidate) =>
      !receiptMatches(
        candidate,
        normalized.articleId,
        normalized.stellarNetwork,
        normalized.tipperId
      )
  )
  persistReceipts([...remaining, normalized].slice(-20), true)
}

export function readPendingArticleTipReceipt(
  articleId: Id<'articles'> | string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): PendingArticleTipReceipt | null {
  return (
    readReceipts().find((receipt) =>
      receiptMatches(receipt, articleId, stellarNetwork, tipperId)
    ) ?? null
  )
}

export function clearPendingArticleTipReceipt(
  articleId: Id<'articles'> | string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): void {
  persistReceipts(
    readReceipts().filter(
      (receipt) => !receiptMatches(receipt, articleId, stellarNetwork, tipperId)
    ),
    false
  )
}
