import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_HIGHLIGHT_TIP_RECEIPTS_STORAGE_KEY =
  'quilltip:pendingHighlightTipReceipts'

const pendingHighlightTipReceiptSchema = z.object({
  articleId: z.string().min(1),
  highlightId: z.string().min(1),
  tipperId: z.string().min(1),
  amountCents: z.number().int().positive(),
  stellarNetwork: z.union([z.literal('TESTNET'), z.literal('MAINNET')]),
  stellarSourceAccount: z.string().min(1),
  intentId: z.string().min(1),
  stellarTxId: z.string().min(1),
  stellarLedger: z.number().int().positive().optional(),
  stellarFeeCharged: z.string().optional(),
  contractTipId: z.string().optional(),
  submittedTipId: z.string().min(1).optional(),
})

type StoredPendingHighlightTipReceipt = z.infer<
  typeof pendingHighlightTipReceiptSchema
>

export type PendingHighlightTipReceipt = Omit<
  StoredPendingHighlightTipReceipt,
  'tipperId' | 'intentId' | 'submittedTipId'
> & {
  tipperId: Id<'users'>
  intentId: Id<'highlightTipIntents'>
  submittedTipId?: Id<'highlightTips'>
}

let memoryReceipts: PendingHighlightTipReceipt[] = []
let storageWriteUnavailable = false

function sameReceiptIdentity(
  left: PendingHighlightTipReceipt,
  right: PendingHighlightTipReceipt
): boolean {
  return (
    left.articleId === right.articleId &&
    left.highlightId === right.highlightId &&
    left.tipperId === right.tipperId &&
    left.intentId === right.intentId &&
    left.stellarNetwork === right.stellarNetwork
  )
}

function matchesContext(
  receipt: PendingHighlightTipReceipt,
  articleId: Id<'articles'> | string,
  highlightId: string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): boolean {
  return (
    receipt.articleId === String(articleId) &&
    receipt.highlightId === highlightId &&
    receipt.stellarNetwork === stellarNetwork &&
    receipt.tipperId === String(tipperId)
  )
}

function persistReceipts(receipts: PendingHighlightTipReceipt[]): void {
  memoryReceipts = receipts.slice(-20)
  if (typeof window === 'undefined' || storageWriteUnavailable) return

  try {
    window.localStorage.setItem(
      PENDING_HIGHLIGHT_TIP_RECEIPTS_STORAGE_KEY,
      JSON.stringify(memoryReceipts)
    )
  } catch {
    storageWriteUnavailable = true
  }
}

function readReceipts(): PendingHighlightTipReceipt[] {
  if (typeof window === 'undefined' || storageWriteUnavailable) {
    return memoryReceipts
  }

  let raw: string | null
  try {
    raw = window.localStorage.getItem(
      PENDING_HIGHLIGHT_TIP_RECEIPTS_STORAGE_KEY
    )
  } catch {
    return memoryReceipts
  }

  if (raw === null) {
    memoryReceipts = []
    return memoryReceipts
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      persistReceipts([])
      return memoryReceipts
    }

    const validReceipts = parsed
      .map((entry) => pendingHighlightTipReceiptSchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data as PendingHighlightTipReceipt)
      .slice(-20)
    memoryReceipts = validReceipts
    if (validReceipts.length !== parsed.length) {
      persistReceipts(validReceipts)
    }
  } catch {
    persistReceipts([])
  }

  return memoryReceipts
}

export function writePendingHighlightTipReceipt(
  receipt: PendingHighlightTipReceipt
): void {
  const normalized = {
    ...receipt,
    articleId: String(receipt.articleId),
    highlightId: String(receipt.highlightId),
    tipperId: String(receipt.tipperId),
    intentId: String(receipt.intentId),
    submittedTipId:
      receipt.submittedTipId === undefined
        ? undefined
        : String(receipt.submittedTipId),
  }
  const parsed = pendingHighlightTipReceiptSchema.safeParse(normalized)
  if (!parsed.success) return
  const validReceipt = parsed.data as PendingHighlightTipReceipt
  const remaining = readReceipts().filter(
    (candidate) => !sameReceiptIdentity(candidate, validReceipt)
  )
  persistReceipts([...remaining, validReceipt])
}

export function readPendingHighlightTipReceipt(
  articleId: Id<'articles'> | string,
  highlightId: string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): PendingHighlightTipReceipt | null {
  const receipts = readReceipts()
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index]!
    if (
      matchesContext(receipt, articleId, highlightId, stellarNetwork, tipperId)
    ) {
      return receipt
    }
  }
  return null
}

export function clearPendingHighlightTipReceipt(
  receipt: PendingHighlightTipReceipt
): void {
  persistReceipts(
    readReceipts().filter(
      (candidate) => !sameReceiptIdentity(candidate, receipt)
    )
  )
}
