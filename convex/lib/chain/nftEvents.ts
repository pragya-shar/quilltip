/**
 * Article NFT events and transaction verification
 * (docs/architecture/v2/04-nft-contract.md, section 4.4; 05-flows-and-admin.md,
 * section 5.10; 06-app-integration.md, sections 6.1 and 6.4).
 *
 * Pure functions. Events are read in their stored, JSON-safe form (bytes as
 * lowercase hex, integers as decimal strings or numbers), so the indexer
 * handlers and the RPC verifier compare the same values.
 *
 * Shapes (contracts/article-nft/src/events.rs; OpenZeppelin stellar-tokens
 * 0.8.0, recorded in scripts/chain/fixtures/v2-local-events.json):
 * - `article_nft_minted`: topics `[name, article_id, author]`, data
 *   `{ token_id: u32, total_at_mint: i128 }`.
 * - `transfer`: topics `[name, from, to]`, data `{ token_id: u32 }`.
 */
import { StrKey } from '@stellar/stellar-sdk'
import {
  EventDecodeError,
  decodeContractEventXdr,
  type DecodedContractEvent,
} from './events'
import { bytesToHex, isHexOfLength } from './ids'

/**
 * The confirmed state of an NFT submission. Named so the tip-status guard
 * (scripts/articles/verified-tips.test.ts) sees no tip confirmation here.
 */
export const NFT_CONFIRMED = 'CONFIRMED' as const

export const NFT_MINTED_EVENT = 'article_nft_minted'
export const NFT_TRANSFER_EVENT = 'transfer'

/** `NftError` codes (contracts/article-nft/src/errors.rs; section 4.4). */
export const NFT_CONTRACT_ERRORS = {
  70: 'BelowThreshold',
  71: 'AlreadyMinted',
  72: 'InvalidThreshold',
  73: 'AlreadyMigrated',
  74: 'UnknownToken',
  75: 'RoyaltyImmutable',
  76: 'AdminRenounceDisabled',
} as const

/**
 * `ConvexError` codes thrown by `convex/nftsV2.ts`, in the `{ code, message }`
 * shape the chain code uses. Some carry extra fields, noted here.
 */
export const NFT_PREPARE_ERROR_CODES = [
  'CHAIN_V2_DISABLED',
  'CHAIN_CONFIG_MISSING',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'NOT_PUBLISHED',
  'NOT_REGISTERED',
  /** The caller's wallet is not linked. */
  'NO_WALLET',
  'WALLET_NOT_VERIFIED',
  /** The caller's verified address is not the on-chain author. `onChainAuthor`. */
  'NOT_ONCHAIN_AUTHOR',
  /** A v2 NFT for this article is already indexed. `nftId`, `tokenId`. */
  'ALREADY_MINTED',
  /** The caller's verified address does not own the token. */
  'NOT_OWNER',
  'NOT_V2_NFT',
  'INVALID_RECIPIENT',
  'RECIPIENT_NOT_FOUND',
  /** The recipient user has no verified wallet address. */
  'RECIPIENT_NO_WALLET',
  'SELF_TRANSFER',
  /** An earlier mint or transfer can still land. `submissionId`. */
  'PENDING',
  /** `retryAfterMs`. */
  'RATE_LIMITED',
  'INVALID_PREPARE',
] as const
export type NftPrepareErrorCode = (typeof NFT_PREPARE_ERROR_CODES)[number]

export type NftMintedFacts = {
  name: typeof NFT_MINTED_EVENT
  articleKey: string
  author: string
  tokenId: number
  /** Decimal string of base units. */
  totalAtMint: string
}

export type NftTransferFacts = {
  name: typeof NFT_TRANSFER_EVENT
  from: string
  to: string
  tokenId: number
}

export type NftEventFacts = NftMintedFacts | NftTransferFacts

type StoredEvent = { name: string | null; topics: unknown[]; data: unknown }

function fail(message: string): never {
  throw new EventDecodeError(message)
}

function address(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !(StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
  ) {
    fail(`${field} is not an address`)
  }
  return value
}

function u32(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    fail(`${field} is not a u32`)
  }
  return value
}

function dataMap(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} data is not a map`)
  }
  return value as Record<string, unknown>
}

/**
 * Facts of a stored NFT event, or null when the event is neither
 * `article_nft_minted` nor `transfer`. Throws `EventDecodeError` for one of
 * those with a bad shape.
 */
export function nftEventFacts(event: StoredEvent): NftEventFacts | null {
  if (event.name === NFT_MINTED_EVENT) {
    if (event.topics.length !== 3) fail('article_nft_minted needs 3 topics')
    const key = event.topics[1]
    if (typeof key !== 'string' || !isHexOfLength(key, 32)) {
      fail('article_id is not 32 bytes')
    }
    const d = dataMap(event.data, NFT_MINTED_EVENT)
    const total = d.total_at_mint
    if (typeof total !== 'string' || !/^[0-9]+$/.test(total)) {
      fail('total_at_mint is not a non-negative integer')
    }
    return {
      name: NFT_MINTED_EVENT,
      articleKey: key,
      author: address(event.topics[2], 'author'),
      tokenId: u32(d.token_id, 'token_id'),
      totalAtMint: total,
    }
  }
  if (event.name === NFT_TRANSFER_EVENT) {
    if (event.topics.length !== 3) fail('transfer needs 3 topics')
    const d = dataMap(event.data, NFT_TRANSFER_EVENT)
    return {
      name: NFT_TRANSFER_EVENT,
      from: address(event.topics[1], 'from'),
      to: address(event.topics[2], 'to'),
      tokenId: u32(d.token_id, 'token_id'),
    }
  }
  return null
}

export const NFT_THRESHOLD_SET_EVENT = 'threshold_set'

/**
 * Facts of a stored `threshold_set` event: topics `[name]`, data
 * `{ token: Address, threshold: i128 }`. Throws `EventDecodeError` for a bad
 * shape.
 */
export function nftThresholdFacts(event: StoredEvent): {
  token: string
  threshold: string
} {
  if (event.name !== NFT_THRESHOLD_SET_EVENT) fail('not threshold_set')
  const d = dataMap(event.data, NFT_THRESHOLD_SET_EVENT)
  const threshold = d.threshold
  if (typeof threshold !== 'string' || !/^[1-9][0-9]*$/.test(threshold)) {
    fail('threshold is not a positive integer')
  }
  return { token: address(d.token, 'token'), threshold }
}

/** The stored form of a decoded value: bigint as string, bytes as hex. */
function stored(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return bytesToHex(value)
  if (Array.isArray(value)) return value.map(stored)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stored(v)])
    )
  }
  return value
}

/** Facts of an event decoded from XDR (`decodeContractEventXdr`). */
export function decodedNftEventFacts(
  event: DecodedContractEvent
): NftEventFacts | null {
  return nftEventFacts({
    name: event.name,
    topics: stored(event.topics) as unknown[],
    data: stored(event.data),
  })
}

export type ExpectedNftMint = {
  action: 'mint'
  articleKey: string
  signer: string
}

export type ExpectedNftTransfer = {
  action: 'transfer'
  tokenId: number
  from: string
  to: string
}

export type ExpectedNft = ExpectedNftMint | ExpectedNftTransfer

export type NftVerification =
  | { status: typeof NFT_CONFIRMED; needsReview: false; facts: NftEventFacts }
  | {
      status: 'MISMATCH'
      /** `author`, `field:<name>` or `no_event`. */
      mismatchReason: string
      needsReview: boolean
      facts: NftEventFacts | null
    }

/** Compares one event with what the submission expects. */
export function matchNftEvent(
  expected: ExpectedNft,
  facts: NftEventFacts
): NftVerification {
  if (expected.action === 'mint') {
    if (facts.name !== NFT_MINTED_EVENT) {
      return {
        status: 'MISMATCH',
        mismatchReason: 'no_event',
        needsReview: true,
        facts: null,
      }
    }
    if (facts.articleKey !== expected.articleKey) {
      return {
        status: 'MISMATCH',
        mismatchReason: 'field:article_id',
        needsReview: true,
        facts,
      }
    }
    // Only the Core author can mint, so a different author means Core's
    // author changed before the call: the token went to that address.
    if (facts.author !== expected.signer) {
      return {
        status: 'MISMATCH',
        mismatchReason: 'author',
        needsReview: false,
        facts,
      }
    }
    return { status: NFT_CONFIRMED, needsReview: false, facts }
  }
  if (facts.name !== NFT_TRANSFER_EVENT) {
    return {
      status: 'MISMATCH',
      mismatchReason: 'no_event',
      needsReview: true,
      facts: null,
    }
  }
  for (const [field, ok] of [
    ['token_id', facts.tokenId === expected.tokenId],
    ['from', facts.from === expected.from],
    ['to', facts.to === expected.to],
  ] as const) {
    if (!ok) {
      return {
        status: 'MISMATCH',
        mismatchReason: `field:${field}`,
        needsReview: true,
        facts,
      }
    }
  }
  return { status: NFT_CONFIRMED, needsReview: false, facts }
}

/**
 * Rule (a) for an NFT submission: RPC returned `SUCCESS` for its hash. Only
 * events of the configured NFT contract count. A mint needs exactly one
 * `article_nft_minted` event; a transfer needs exactly one `transfer` event
 * for the expected token. A `SUCCESS` transaction never yields `FAILED`.
 */
export function verifyNftTransaction(input: {
  expected: ExpectedNft
  nftContractId: string
  contractEventsXdr: string[][]
  ledger: number
  createdLedger?: number | null
}): NftVerification {
  const wanted =
    input.expected.action === 'mint' ? NFT_MINTED_EVENT : NFT_TRANSFER_EVENT
  const found: NftEventFacts[] = []
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
      if (decoded.contractId !== input.nftContractId) continue
      if (decoded.name !== wanted) continue
      try {
        const facts = decodedNftEventFacts(decoded)
        if (!facts) continue
        if (
          input.expected.action === 'transfer' &&
          facts.name === NFT_TRANSFER_EVENT &&
          facts.tokenId !== input.expected.tokenId
        ) {
          continue
        }
        found.push(facts)
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
          : 'field:event_count',
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
  return matchNftEvent(input.expected, found[0]!)
}

/** The `nftKey` of a mint submission. */
export function mintNftKey(nftContractId: string, articleKey: string): string {
  return `${nftContractId}:mint:${articleKey}`
}

/** The `nftKey` of a transfer submission. */
export function tokenNftKey(nftContractId: string, tokenId: number): string {
  return `${nftContractId}:token:${tokenId}`
}

/** 32 bytes of hex as a 43-character base64url Arweave transaction ID. */
export function arweaveIdFromHex(
  hex: string | null | undefined
): string | null {
  if (!hex || !isHexOfLength(hex, 32)) return null
  let binary = ''
  for (let i = 0; i < 64; i += 2) {
    binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
