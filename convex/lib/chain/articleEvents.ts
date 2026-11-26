/**
 * Verification of article submissions: register, content update and the
 * two author-change steps (docs/architecture/v2/05-flows-and-admin.md,
 * section 5.1; 02-core-contract.md, sections 2.2 and 2.4).
 *
 * Pure functions. They read an event either as decoded from transaction XDR
 * (bytes as `Uint8Array`) or as stored by the indexer (bytes as lowercase
 * hex), and compare it with the values fixed at prepare.
 *
 * - Only events from the configured Core contract count.
 * - A `SUCCESS` transaction without the expected event is `MISMATCH` with
 *   `no_event`; a field that differs is `MISMATCH` with `field:<name>`. Both
 *   need review. A `SUCCESS` transaction never yields `FAILED`.
 */
import { StrKey } from '@stellar/stellar-sdk'
import type { Doc } from '../../_generated/dataModel'
import {
  EventDecodeError,
  decodeContractEventXdr,
  type DecodedContractEvent,
} from './events'
import { bytesToHex } from './ids'

export const ARTICLE_SUBMISSION_KINDS = [
  'register',
  'content_update',
  'author_propose',
  'author_accept',
] as const
export type ArticleSubmissionKind = (typeof ARTICLE_SUBMISSION_KINDS)[number]

export function isArticleSubmissionKind(
  kind: string
): kind is ArticleSubmissionKind {
  return (ARTICLE_SUBMISSION_KINDS as readonly string[]).includes(kind)
}

/** The Core event each article submission kind must emit. */
export const ARTICLE_EVENT_FOR_KIND: Record<ArticleSubmissionKind, string> = {
  register: 'article_registered',
  content_update: 'content_updated',
  author_propose: 'author_proposed',
  author_accept: 'author_changed',
}

export type ExpectedArticle = NonNullable<
  Doc<'chainSubmissions'>['expectedArticle']
>

/** Normalised fields of one Core article event. Bytes are lowercase hex. */
export type ArticleEventFacts = {
  name: string
  articleKey: string
  author?: string
  articleRef?: string
  contentHash?: string
  arweaveId?: string | null
  splits?: Array<{ recipient: string; bps: number }>
  contentVersion?: number
  newAuthor?: string
  liveUntilLedger?: number
  previous?: string
}

function hexOf(value: unknown, length: number, field: string): string {
  if (value instanceof Uint8Array && value.length === length) {
    return bytesToHex(value)
  }
  if (
    typeof value === 'string' &&
    value.length === length * 2 &&
    /^[0-9a-f]+$/.test(value)
  ) {
    return value
  }
  throw new EventDecodeError(`${field} is not ${length} bytes`)
}

function optionalHex(value: unknown, length: number, field: string) {
  return value === null || value === undefined
    ? null
    : hexOf(value, length, field)
}

function addressOf(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !(StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
  ) {
    throw new EventDecodeError(`${field} is not an address`)
  }
  return value
}

function u32Of(value: unknown, field: string): number {
  const n = typeof value === 'bigint' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new EventDecodeError(`${field} is not a u32`)
  }
  return n
}

function splitsOf(value: unknown) {
  if (!Array.isArray(value)) throw new EventDecodeError('splits is not a list')
  return value.map((item, i) => {
    const s = (item ?? {}) as Record<string, unknown>
    return {
      recipient: addressOf(s.recipient, `splits[${i}].recipient`),
      bps: u32Of(s.bps, `splits[${i}].bps`),
    }
  })
}

const ARTICLE_EVENT_NAMES = new Set(Object.values(ARTICLE_EVENT_FOR_KIND))

/**
 * Reads an article event's fields from its topics and data, decoded or
 * stored. Returns null for any other event; throws `EventDecodeError` for an
 * article event with a bad shape.
 */
export function articleEventFacts(event: {
  name: string | null
  topics: unknown[]
  data: unknown
}): ArticleEventFacts | null {
  if (!event.name || !ARTICLE_EVENT_NAMES.has(event.name)) return null
  const d = event.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new EventDecodeError(`${event.name} data is not a map`)
  }
  const data = d as Record<string, unknown>
  const articleKey = hexOf(event.topics[1], 32, 'article_id')
  switch (event.name) {
    case 'article_registered':
      return {
        name: event.name,
        articleKey,
        author: addressOf(event.topics[2], 'author'),
        articleRef: hexOf(data.article_ref, 32, 'article_ref'),
        contentHash: hexOf(data.content_hash, 32, 'content_hash'),
        arweaveId: optionalHex(data.arweave_id, 32, 'arweave_id'),
        splits: splitsOf(data.splits),
      }
    case 'content_updated':
      return {
        name: event.name,
        articleKey,
        contentHash: hexOf(data.content_hash, 32, 'content_hash'),
        arweaveId: optionalHex(data.arweave_id, 32, 'arweave_id'),
        contentVersion: u32Of(data.content_version, 'content_version'),
      }
    case 'author_proposed':
      return {
        name: event.name,
        articleKey,
        newAuthor: addressOf(data.new_author, 'new_author'),
        liveUntilLedger: u32Of(data.live_until_ledger, 'live_until_ledger'),
      }
    default:
      return {
        name: event.name,
        articleKey,
        previous: addressOf(data.previous, 'previous'),
        newAuthor: addressOf(data.new, 'new'),
      }
  }
}

/**
 * The confirmed state of an article submission. Article submissions are not
 * tip rows; tip rows are confirmed only through `confirmedTipPatch`.
 */
export const ARTICLE_CONFIRMED = 'CONFIRMED' as const

export type ArticleVerification =
  | {
      status: typeof ARTICLE_CONFIRMED
      needsReview: false
      facts: ArticleEventFacts
    }
  | {
      status: 'MISMATCH'
      mismatchReason: string
      needsReview: true
      facts: ArticleEventFacts | null
    }

function sameSplits(
  a: ArticleEventFacts['splits'],
  b: ExpectedArticle['splits']
): boolean {
  const left = a ?? []
  const right = b ?? []
  return (
    left.length === right.length &&
    left.every(
      (s, i) => s.recipient === right[i]!.recipient && s.bps === right[i]!.bps
    )
  )
}

/** Compares one article event with the values fixed at prepare. */
export function matchArticleEvent(
  kind: ArticleSubmissionKind,
  expected: ExpectedArticle,
  facts: ArticleEventFacts
): ArticleVerification {
  const mismatch = (field: string): ArticleVerification => ({
    status: 'MISMATCH',
    mismatchReason: `field:${field}`,
    needsReview: true,
    facts,
  })
  if (facts.name !== ARTICLE_EVENT_FOR_KIND[kind]) return mismatch('event')
  if (facts.articleKey !== expected.articleKey) return mismatch('article_id')
  if (kind === 'register') {
    if (facts.author !== expected.author) return mismatch('author')
    if (facts.articleRef !== expected.articleRef) return mismatch('article_ref')
    if (facts.contentHash !== expected.contentHash) {
      return mismatch('content_hash')
    }
    if ((facts.arweaveId ?? null) !== (expected.arweaveId ?? null)) {
      return mismatch('arweave_id')
    }
    if (!sameSplits(facts.splits, expected.splits)) return mismatch('splits')
  } else if (kind === 'content_update') {
    if (facts.contentHash !== expected.contentHash) {
      return mismatch('content_hash')
    }
    if ((facts.arweaveId ?? null) !== (expected.arweaveId ?? null)) {
      return mismatch('arweave_id')
    }
    if (facts.contentVersion !== expected.contentVersion) {
      return mismatch('content_version')
    }
  } else if (kind === 'author_propose') {
    if (facts.newAuthor !== expected.newAuthor) return mismatch('new_author')
    if (facts.liveUntilLedger !== expected.liveUntilLedger) {
      return mismatch('live_until_ledger')
    }
  } else {
    if (facts.newAuthor !== expected.newAuthor) return mismatch('new')
    if (facts.previous !== expected.author) return mismatch('previous')
  }
  return { status: ARTICLE_CONFIRMED, needsReview: false, facts }
}

/**
 * Verifies a transaction that RPC reports as `SUCCESS` for an article
 * submission. Exactly one expected event from Core must be present.
 */
export function verifyArticleTransaction(input: {
  kind: ArticleSubmissionKind
  expected: ExpectedArticle
  coreContractId: string
  contractEventsXdr: string[][]
  ledger: number
  createdLedger?: number | null
}): ArticleVerification {
  const wanted = ARTICLE_EVENT_FOR_KIND[input.kind]
  const found: ArticleEventFacts[] = []
  let malformed = false
  for (const op of input.contractEventsXdr) {
    for (const raw of op) {
      let decoded: DecodedContractEvent
      try {
        decoded = decodeContractEventXdr(raw)
      } catch (error) {
        if (error instanceof EventDecodeError) continue
        throw error
      }
      if (decoded.contractId !== input.coreContractId) continue
      if (decoded.name !== wanted) continue
      try {
        const facts = articleEventFacts(decoded)
        if (facts) found.push(facts)
      } catch (error) {
        if (error instanceof EventDecodeError) {
          malformed = true
          continue
        }
        throw error
      }
    }
  }
  if (found.length !== 1) {
    return {
      status: 'MISMATCH',
      mismatchReason:
        found.length === 0
          ? malformed
            ? 'field:event'
            : 'no_event'
          : 'field:article_id',
      needsReview: true,
      facts: found[0] ?? null,
    }
  }
  if (
    input.createdLedger !== undefined &&
    input.createdLedger !== null &&
    input.ledger < input.createdLedger
  ) {
    return {
      status: 'MISMATCH',
      mismatchReason: 'field:ledger',
      needsReview: true,
      facts: found[0]!,
    }
  }
  return matchArticleEvent(input.kind, input.expected, found[0]!)
}
