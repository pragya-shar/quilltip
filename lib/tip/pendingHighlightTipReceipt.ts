import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX =
  'quilltip:pendingHighlightTipReceipt:v2:'

const MAX_PENDING_HIGHLIGHT_TIP_RECEIPTS = 20
const STORAGE_FAILURE_MESSAGE =
  'Your signed tip could not be saved for safe recovery. No transaction was sent. Free browser storage or allow site storage, then retry.'

const pendingHighlightTipReceiptSchema = z.object({
  articleId: z.string().min(1),
  highlightId: z.string().min(1),
  tipperId: z.string().min(1),
  amountCents: z.number().int().positive(),
  stellarNetwork: z.union([z.literal('TESTNET'), z.literal('MAINNET')]),
  stellarSourceAccount: z.string().min(1),
  intentId: z.string().min(1),
  signedXdr: z.string().min(1),
  stellarTxId: z.string().min(1),
  stellarLedger: z.number().int().positive().optional(),
  stellarFeeCharged: z.string().optional(),
  contractTipId: z.string().optional(),
  submittedTipId: z.string().min(1).optional(),
  broadcastAcceptedAt: z.number().int().positive().optional(),
  savedAt: z.number().int().positive().optional(),
})

type StoredPendingHighlightTipReceipt = z.infer<
  typeof pendingHighlightTipReceiptSchema
>

export type PendingHighlightTipReceipt = Omit<
  StoredPendingHighlightTipReceipt,
  'tipperId' | 'intentId'
> & {
  tipperId: Id<'users'>
  intentId: Id<'highlightTipIntents'>
}

type StoredReceiptEntry = {
  key: string
  receipt: PendingHighlightTipReceipt
}

function normalizeReceipt(
  receipt: PendingHighlightTipReceipt
): PendingHighlightTipReceipt {
  const parsed = pendingHighlightTipReceiptSchema.safeParse({
    ...receipt,
    articleId: String(receipt.articleId),
    highlightId: String(receipt.highlightId),
    tipperId: String(receipt.tipperId),
    intentId: String(receipt.intentId),
    submittedTipId:
      receipt.submittedTipId === undefined
        ? undefined
        : String(receipt.submittedTipId),
  })
  if (!parsed.success) {
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }
  return parsed.data as PendingHighlightTipReceipt
}

function receiptStorageKey(receipt: PendingHighlightTipReceipt): string {
  return `${PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX}${[
    receipt.stellarNetwork,
    receipt.tipperId,
    receipt.articleId,
    receipt.highlightId,
    receipt.intentId,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(':')}`
}

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

function discardMalformedKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // A read must remain safe even when browser storage is unavailable.
  }
}

function readStoredEntries(): StoredReceiptEntry[] | null {
  if (typeof window === 'undefined') return []

  const entries: StoredReceiptEntry[] = []
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX)) {
        continue
      }
      keys.push(key)
    }

    for (const key of keys) {
      const raw = window.localStorage.getItem(key)
      if (raw === null) continue
      try {
        const parsed = pendingHighlightTipReceiptSchema.safeParse(
          JSON.parse(raw) as unknown
        )
        if (!parsed.success) {
          discardMalformedKey(key)
          continue
        }
        entries.push({
          key,
          receipt: parsed.data as PendingHighlightTipReceipt,
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

export function writePendingHighlightTipReceipt(
  receipt: PendingHighlightTipReceipt
): void {
  if (typeof window === 'undefined') {
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }

  const normalized = normalizeReceipt({ ...receipt, savedAt: Date.now() })
  const key = receiptStorageKey(normalized)
  const storedEntries = readStoredEntries()
  if (storedEntries === null) {
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }
  const replacesExisting = storedEntries.some((entry) => entry.key === key)
  if (
    !replacesExisting &&
    storedEntries.length >= MAX_PENDING_HIGHLIGHT_TIP_RECEIPTS
  ) {
    throw new Error(
      'You already have 20 pending highlight tips. Retry or finish one before starting another payment.'
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

  const entriesAfterWrite = readStoredEntries()
  if (entriesAfterWrite === null) {
    if (!replacesExisting) discardMalformedKey(key)
    throw new Error(STORAGE_FAILURE_MESSAGE)
  }
  if (
    !replacesExisting &&
    entriesAfterWrite.length > MAX_PENDING_HIGHLIGHT_TIP_RECEIPTS
  ) {
    discardMalformedKey(key)
    throw new Error(
      'You already have 20 pending highlight tips. Retry or finish one before starting another payment.'
    )
  }
}

export function readPendingHighlightTipReceipt(
  articleId: Id<'articles'> | string,
  highlightId: string,
  stellarNetwork: 'TESTNET' | 'MAINNET',
  tipperId: Id<'users'> | string
): PendingHighlightTipReceipt | null {
  const matches = (readStoredEntries() ?? []).filter(({ receipt }) =>
    matchesContext(receipt, articleId, highlightId, stellarNetwork, tipperId)
  )
  matches.sort(
    (left, right) =>
      (left.receipt.savedAt ?? 0) - (right.receipt.savedAt ?? 0) ||
      left.key.localeCompare(right.key)
  )
  return matches.at(-1)?.receipt ?? null
}

export function clearPendingHighlightTipReceipt(
  receipt: PendingHighlightTipReceipt
): void {
  if (typeof window === 'undefined') return
  for (const entry of readStoredEntries() ?? []) {
    if (!sameReceiptIdentity(entry.receipt, receipt)) continue
    try {
      window.localStorage.removeItem(entry.key)
    } catch {
      // A terminal UI transition must not crash if storage cleanup is blocked.
    }
  }
}
