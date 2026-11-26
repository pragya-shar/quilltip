/**
 * Contract event decoding (docs/architecture/v2/02-core-contract.md, section
 * 2.4). Works in the Convex default runtime.
 *
 * `#[contractevent]` puts the snake_case event name first in the topics and,
 * by default, the remaining fields in a map keyed by field name.
 */
import { StrKey, scValToNative, xdr } from '@stellar/stellar-sdk'
import { bytesToHex } from './ids'

export type DecodedContractEvent = {
  /** `C…` address, or null for a system event. */
  contractId: string | null
  /** Event name: the first topic when it is a symbol, otherwise null. */
  name: string | null
  topics: unknown[]
  data: unknown
}

export class EventDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventDecodeError'
  }
}

/** Decodes a base64 `ContractEvent` as returned in `contractEventsXdr`. */
export function decodeContractEventXdr(base64: string): DecodedContractEvent {
  let event: xdr.ContractEvent
  try {
    event = xdr.ContractEvent.fromXdr(base64, 'base64')
  } catch (error) {
    throw new EventDecodeError(
      `Invalid ContractEvent XDR: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // Only contract events carry payment facts; system and diagnostic events
  // are ignored even when they come from the configured contract.
  if (event.type !== xdr.ContractEventType.contract) {
    throw new EventDecodeError(`Unsupported event type ${event.type.name}`)
  }
  if (event.body.type !== 'v0') {
    throw new EventDecodeError(`Unsupported event body ${event.body.type}`)
  }
  const topics = event.body.v0.topics.map((topic) => scValToNative(topic))
  return {
    contractId: event.contractId
      ? StrKey.encodeContract(event.contractId.toBytes())
      : null,
    name:
      topics[0] !== undefined && topicIsSymbol(event.body.v0.topics[0])
        ? String(topics[0])
        : null,
    topics,
    data: scValToNative(event.body.v0.data),
  }
}

/** Decodes an event from `getEvents` (topics and value as base64 `ScVal`). */
export function decodeRpcEvent(event: {
  contractId: string
  topic: string[]
  value: string
}): DecodedContractEvent {
  try {
    const topicVals = event.topic.map((t) => xdr.ScVal.fromXdr(t, 'base64'))
    const topics = topicVals.map((t) => scValToNative(t))
    return {
      contractId: event.contractId || null,
      name:
        topicVals[0] && topicIsSymbol(topicVals[0]) ? String(topics[0]) : null,
      topics,
      data: scValToNative(xdr.ScVal.fromXdr(event.value, 'base64')),
    }
  } catch (error) {
    throw new EventDecodeError(
      `Invalid event: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function topicIsSymbol(topic: xdr.ScVal | undefined): boolean {
  return topic?.type === 'scvSymbol'
}

/** Core `Tipped` event, decoded. Byte fields are lower-case hex. */
export type TippedEvent = {
  articleId: string
  author: string
  tipper: string
  token: string
  gross: bigint
  fee: bigint
  net: bigint
  highlightId: string | null
  contentHash: string
  contentVersion: number
  clientRef: string
  totalAfter: bigint
  splitCount: number
}

export const TIPPED_EVENT_NAME = 'tipped'

function bytes(value: unknown, length: number, field: string): string {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new EventDecodeError(`Tipped.${field} is not ${length} bytes`)
  }
  return bytesToHex(value)
}

function address(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !(
      StrKey.isValidEd25519PublicKey(value) ||
      StrKey.isValidContract(value) ||
      StrKey.isValidMed25519PublicKey(value)
    )
  ) {
    throw new EventDecodeError(`Tipped.${field} is not an address`)
  }
  return value
}

function bigintField(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint') {
    throw new EventDecodeError(`Tipped.${field} is not an integer`)
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
    throw new EventDecodeError(`Tipped.${field} is not a u32`)
  }
  return value
}

/**
 * Returns the `Tipped` fields, or null when the event is not a `Tipped`
 * event. Throws `EventDecodeError` for a `Tipped` event with a bad shape.
 */
export function parseTippedEvent(
  event: DecodedContractEvent
): TippedEvent | null {
  if (event.name !== TIPPED_EVENT_NAME) return null
  if (event.topics.length !== 3) {
    throw new EventDecodeError('Tipped must have three topics')
  }
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new EventDecodeError('Tipped data is not a map')
  }
  const d = data as Record<string, unknown>
  const highlight = d.highlight_id
  return {
    articleId: bytes(event.topics[1], 32, 'article_id'),
    author: address(event.topics[2], 'author'),
    tipper: address(d.tipper, 'tipper'),
    token: address(d.token, 'token'),
    gross: bigintField(d.gross, 'gross'),
    fee: bigintField(d.fee, 'fee'),
    net: bigintField(d.net, 'net'),
    highlightId:
      highlight === null || highlight === undefined
        ? null
        : bytes(highlight, 32, 'highlight_id'),
    contentHash: bytes(d.content_hash, 32, 'content_hash'),
    contentVersion: u32(d.content_version, 'content_version'),
    clientRef: bytes(d.client_ref, 16, 'client_ref'),
    totalAfter: bigintField(d.total_after, 'total_after'),
    splitCount: u32(d.split_count, 'split_count'),
  }
}
