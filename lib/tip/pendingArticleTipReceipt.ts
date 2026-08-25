import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY =
  'quilltip:pendingArticleTipReceipts'
const STORAGE_FAILURE_MESSAGE =
  'Your signed tip could not be saved for safe recovery. No transaction was sent. Free browser storage or allow site storage, then retry.'

const pendingArticleTipReceiptBaseSchema = z.object({
  articleId: z.string().min(1),
  tipperId: z.string().min(1),
  amountCents: z.number().int().positive(),
  message: z.string().max(500).optional(),
  stellarNetwork: z.union([z.literal('TESTNET'), z.literal('MAINNET')]),
  stellarSourceAccount: z.string().min(1),
  intentId: z.string().min(1),
  stellarTxId: z.string().min(1),
  stellarLedger: z.number().int().positive().optional(),
  stellarFeeCharged: z.string().optional(),
  contractTipId: z.string().optional(),
  submittedTipId: z.string().min(1).optional(),
})

const currentPendingArticleTipReceiptSchema =
  pendingArticleTipReceiptBaseSchema.extend({
    signedXdr: z.string().min(1),
  })

const legacyPendingArticleTipReceiptSchema =
  pendingArticleTipReceiptBaseSchema.extend({
    signedXdr: z.never().optional(),
  })

const pendingArticleTipReceiptSchema = z.union([
  currentPendingArticleTipReceiptSchema,
  legacyPendingArticleTipReceiptSchema,
])

type StoredCurrentPendingArticleTipReceipt = z.infer<
  typeof currentPendingArticleTipReceiptSchema
>

type StoredLegacyPendingArticleTipReceipt = z.infer<
  typeof legacyPendingArticleTipReceiptSchema
>

export type CurrentPendingArticleTipReceipt = Omit<
  StoredCurrentPendingArticleTipReceipt,
  'tipperId' | 'intentId' | 'submittedTipId'
> & {
  tipperId: Id<'users'>
  intentId: Id<'articleTipIntents'>
  submittedTipId?: Id<'tips'>
}

export type LegacyPendingArticleTipReceipt = Omit<
  StoredLegacyPendingArticleTipReceipt,
  'tipperId' | 'intentId' | 'submittedTipId'
> & {
  tipperId: Id<'users'>
  intentId: Id<'articleTipIntents'>
  submittedTipId?: Id<'tips'>
}

export type PendingArticleTipReceipt =
  | CurrentPendingArticleTipReceipt
  | LegacyPendingArticleTipReceipt

export function hasExactSignedArticleTipXdr(
  receipt: PendingArticleTipReceipt
): receipt is CurrentPendingArticleTipReceipt {
  return typeof receipt.signedXdr === 'string' && receipt.signedXdr.length > 0
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
    if (!Array.isArray(parsed)) return memoryReceipts

    memoryReceipts = parsed.slice(-20).flatMap((entry) => {
      const result = pendingArticleTipReceiptSchema.safeParse(entry)
      return result.success ? [result.data as PendingArticleTipReceipt] : []
    })
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
  receipt: CurrentPendingArticleTipReceipt
): void {
  const result = currentPendingArticleTipReceiptSchema.safeParse(receipt)
  if (!result.success) {
    throw new Error(
      'A new article tip recovery receipt requires the exact signed XDR.'
    )
  }
  const normalized: PendingArticleTipReceipt = {
    ...result.data,
    articleId: String(result.data.articleId),
    tipperId: result.data.tipperId as Id<'users'>,
    intentId: result.data.intentId as Id<'articleTipIntents'>,
    submittedTipId: result.data.submittedTipId as Id<'tips'> | undefined,
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
