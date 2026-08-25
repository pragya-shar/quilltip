import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY =
  'quilltip:pendingArticleTipReceipts'
export const PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX =
  'quilltip:pendingArticleTipReceipt:v2:'

const MAX_PENDING_ARTICLE_TIP_RECEIPTS = 20
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

type StoredReceiptEntry = {
  key: string
  receipt: CurrentPendingArticleTipReceipt
}

export function hasExactSignedArticleTipXdr(
  receipt: PendingArticleTipReceipt
): receipt is CurrentPendingArticleTipReceipt {
  return typeof receipt.signedXdr === 'string' && receipt.signedXdr.length > 0
}

function normalizeCurrentReceipt(
  receipt: CurrentPendingArticleTipReceipt
): CurrentPendingArticleTipReceipt {
  const parsed = currentPendingArticleTipReceiptSchema.safeParse({
    ...receipt,
    articleId: String(receipt.articleId),
    tipperId: String(receipt.tipperId),
    intentId: String(receipt.intentId),
    submittedTipId:
      receipt.submittedTipId === undefined
        ? undefined
        : String(receipt.submittedTipId),
  })
  if (!parsed.success) {
    throw new Error(
      'A new article tip recovery receipt requires the exact signed XDR.'
    )
  }
  return parsed.data as CurrentPendingArticleTipReceipt
}

function receiptStorageKey(receipt: CurrentPendingArticleTipReceipt): string {
  return `${PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX}${[
    receipt.stellarNetwork,
    receipt.tipperId,
    receipt.articleId,
    receipt.intentId,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(':')}`
}

function receiptMatchesContext(
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

function sameReceiptIdentity(
  left: PendingArticleTipReceipt,
  right: PendingArticleTipReceipt
): boolean {
  return (
    receiptMatchesContext(
      left,
      right.articleId,
      right.stellarNetwork,
      right.tipperId
    ) && left.intentId === right.intentId
  )
}

function discardMalformedKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Reads remain safe when malformed storage cannot be cleaned up.
  }
}

function readPerReceiptEntries(): StoredReceiptEntry[] | null {
  if (typeof window === 'undefined') return []

  const entries: StoredReceiptEntry[] = []
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX)) {
        continue
      }
      keys.push(key)
    }

    for (const key of keys) {
      const raw = window.localStorage.getItem(key)
      if (raw === null) continue
      try {
        const parsed = currentPendingArticleTipReceiptSchema.safeParse(
          JSON.parse(raw) as unknown
        )
        if (!parsed.success) {
          discardMalformedKey(key)
          continue
        }
        entries.push({
          key,
          receipt: parsed.data as CurrentPendingArticleTipReceipt,
        })
      } catch {
        discardMalformedKey(key)
      }
    }
  } catch {
    return null
  }

  return entries.sort((left, right) => left.key.localeCompare(right.key))
}

function readLegacyReceipts(): PendingArticleTipReceipt[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(
      PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY
    )
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((entry) => {
        const result = pendingArticleTipReceiptSchema.safeParse(entry)
        return result.success ? [result.data as PendingArticleTipReceipt] : []
      })
      .slice(-MAX_PENDING_ARTICLE_TIP_RECEIPTS)
  } catch {
    return []
  }
}

function readAllReceipts(): PendingArticleTipReceipt[] | null {
  const perReceiptEntries = readPerReceiptEntries()
  if (perReceiptEntries === null) return null
  const receipts: PendingArticleTipReceipt[] = perReceiptEntries.map(
    (entry) => entry.receipt
  )
  for (const legacyReceipt of readLegacyReceipts()) {
    if (
      receipts.some((receipt) => sameReceiptIdentity(receipt, legacyReceipt))
    ) {
      continue
    }
    receipts.push(legacyReceipt)
  }
  return receipts
}

export function writePendingArticleTipReceipt(
  receipt: CurrentPendingArticleTipReceipt
): void {
  if (typeof window === 'undefined') {
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }

  const normalized = normalizeCurrentReceipt(receipt)
  const key = receiptStorageKey(normalized)
  const storedReceipts = readAllReceipts()
  if (storedReceipts === null) throw new Error(STORAGE_FAILURE_MESSAGE)
  const replacesExisting = storedReceipts.some((candidate) =>
    sameReceiptIdentity(candidate, normalized)
  )
  if (
    !replacesExisting &&
    storedReceipts.length >= MAX_PENDING_ARTICLE_TIP_RECEIPTS
  ) {
    throw new Error(
      'You already have 20 pending article tips. Retry or finish one before starting another payment.'
    )
  }

  const serialized = JSON.stringify(normalized)
  try {
    window.localStorage.setItem(key, serialized)
    if (window.localStorage.getItem(key) !== serialized) {
      throw new Error('durability check failed')
    }
  } catch {
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }

  const receiptsAfterWrite = readAllReceipts()
  if (receiptsAfterWrite === null) {
    if (!replacesExisting) discardMalformedKey(key)
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }
  if (
    !replacesExisting &&
    receiptsAfterWrite.length > MAX_PENDING_ARTICLE_TIP_RECEIPTS
  ) {
    discardMalformedKey(key)
    throw new Error(
      'You already have 20 pending article tips. Retry or finish one before starting another payment.'
    )
  }
}

export function readPendingArticleTipReceipt(
  articleId: Id<'articles'> | string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): PendingArticleTipReceipt | null {
  return (
    (readAllReceipts() ?? []).find((receipt) =>
      receiptMatchesContext(receipt, articleId, stellarNetwork, tipperId)
    ) ?? null
  )
}

export function clearPendingArticleTipReceipt(
  articleId: Id<'articles'> | string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): void {
  if (typeof window === 'undefined') return

  for (const entry of readPerReceiptEntries() ?? []) {
    if (
      !receiptMatchesContext(entry.receipt, articleId, stellarNetwork, tipperId)
    ) {
      continue
    }
    try {
      window.localStorage.removeItem(entry.key)
    } catch {
      // A terminal UI transition must not crash if cleanup is blocked.
    }
  }

  const remainingLegacy = readLegacyReceipts().filter(
    (receipt) =>
      !receiptMatchesContext(receipt, articleId, stellarNetwork, tipperId)
  )
  try {
    if (remainingLegacy.length === 0) {
      window.localStorage.removeItem(PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY)
    } else {
      window.localStorage.setItem(
        PENDING_ARTICLE_TIP_RECEIPTS_STORAGE_KEY,
        JSON.stringify(remainingLegacy)
      )
    }
  } catch {
    // Cleanup failure cannot turn a confirmed payment back into a UI error.
  }
}
