/**
 * Server-side tip verification (docs/architecture/v2/06-app-integration.md,
 * section 6.4). Pure functions: the caller fetches the transaction and applies
 * the outcome.
 *
 * Rules:
 * - Only events from the configured Core contract count.
 * - Exactly one `Tipped` event per expected `client_ref`.
 * - A payment-field difference is `MISMATCH` with `field:<name>` and
 *   `needsReview`; a missing event is `MISMATCH` with `no_event` and
 *   `needsReview`. A `SUCCESS` transaction never yields `FAILED`.
 * - A different `author` is `MISMATCH` with `author` and the on-chain address.
 */
import { FEE_BPS, BPS_DENOMINATOR } from './fees'
import {
  EventDecodeError,
  decodeContractEventXdr,
  parseTippedEvent,
  type TippedEvent,
} from './events'

export type ExpectedTip = {
  /** Caller's key for the row, returned in the outcome. */
  key: string
  clientRef: string
  articleKey: string
  tipper: string
  token: string
  /** Decimal string of base units. */
  gross: string
  highlightKey: string | null
  author: string
}

export type TipVerification =
  | {
      key: string
      status: 'CONFIRMED'
      needsReview: false
      event: TippedEvent
    }
  | {
      key: string
      status: 'MISMATCH'
      mismatchReason: string
      needsReview: boolean
      /** Present when an event was found for the row. */
      event: TippedEvent | null
    }

export function tipFee(gross: bigint): bigint {
  return (gross * BigInt(FEE_BPS)) / BigInt(BPS_DENOMINATOR)
}

/** Compares one decoded `Tipped` event with its expected row. */
export function matchTippedEvent(
  expected: ExpectedTip,
  event: TippedEvent
): TipVerification {
  const mismatch = (field: string): TipVerification => ({
    key: expected.key,
    status: 'MISMATCH',
    mismatchReason: `field:${field}`,
    needsReview: true,
    event,
  })
  if (event.articleId !== expected.articleKey) return mismatch('article_id')
  if (event.tipper !== expected.tipper) return mismatch('tipper')
  if (event.token !== expected.token) return mismatch('token')
  if (event.gross.toString() !== expected.gross) return mismatch('gross')
  if (event.clientRef !== expected.clientRef) return mismatch('client_ref')
  if ((event.highlightId ?? null) !== (expected.highlightKey ?? null)) {
    return mismatch('highlight_id')
  }
  if (event.fee !== tipFee(event.gross)) return mismatch('fee')
  if (event.author !== expected.author) {
    return {
      key: expected.key,
      status: 'MISMATCH',
      mismatchReason: 'author',
      needsReview: false,
      event,
    }
  }
  return { key: expected.key, status: 'CONFIRMED', needsReview: false, event }
}

export type TransactionVerificationInput = {
  expected: ExpectedTip[]
  coreContractId: string
  contractEventsXdr: string[][]
  /** Ledger of the transaction. */
  ledger: number
  /** Latest ledger known when the record was prepared, if any. */
  createdLedger?: number | null
}

/**
 * Verifies a transaction that RPC reports as `SUCCESS`. Returns one outcome
 * per expected row, in input order.
 */
export function verifyTippedTransaction(
  input: TransactionVerificationInput
): TipVerification[] {
  const byRef = new Map<string, TippedEvent[]>()
  let malformed = false
  for (const op of input.contractEventsXdr) {
    for (const raw of op) {
      let decoded
      try {
        decoded = decodeContractEventXdr(raw)
      } catch (error) {
        if (error instanceof EventDecodeError) continue
        throw error
      }
      if (decoded.contractId !== input.coreContractId) continue
      try {
        const tipped = parseTippedEvent(decoded)
        if (!tipped) continue
        const list = byRef.get(tipped.clientRef) ?? []
        list.push(tipped)
        byRef.set(tipped.clientRef, list)
      } catch (error) {
        if (error instanceof EventDecodeError) {
          malformed = true
          continue
        }
        throw error
      }
    }
  }

  return input.expected.map((expected): TipVerification => {
    const events = byRef.get(expected.clientRef) ?? []
    if (events.length !== 1) {
      return {
        key: expected.key,
        status: 'MISMATCH',
        mismatchReason:
          events.length === 0
            ? malformed
              ? 'field:event'
              : 'no_event'
            : 'field:client_ref',
        needsReview: true,
        event: events[0] ?? null,
      }
    }
    if (
      input.createdLedger !== undefined &&
      input.createdLedger !== null &&
      input.ledger < input.createdLedger
    ) {
      return {
        key: expected.key,
        status: 'MISMATCH',
        mismatchReason: 'field:ledger',
        needsReview: true,
        event: events[0]!,
      }
    }
    return matchTippedEvent(expected, events[0]!)
  })
}

/**
 * Status of a submission from its rows. A batch is atomic: one mismatched row
 * makes the submission `MISMATCH`.
 */
export function aggregateVerification(outcomes: TipVerification[]): {
  status: 'CONFIRMED' | 'MISMATCH'
  mismatchReason?: string
  needsReview: boolean
} {
  const mismatch = outcomes.find((o) => o.status === 'MISMATCH')
  if (!mismatch || mismatch.status !== 'MISMATCH') {
    return { status: 'CONFIRMED', needsReview: false }
  }
  return {
    status: 'MISMATCH',
    mismatchReason: mismatch.mismatchReason,
    needsReview: outcomes.some((o) => o.needsReview),
  }
}
