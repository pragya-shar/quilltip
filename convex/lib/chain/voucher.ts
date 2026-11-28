/**
 * Tab voucher acceptance primitives for Convex
 * (docs/architecture/v2/03-tab-contract.md, sections 3.4 and 3.6;
 * 06-app-integration.md, section 6.3).
 *
 * Payload, acceptance, receipt leaf and Merkle root bytes come from the shared
 * encoder in `lib/stellar/v2/tab/encoding.ts`, which the client and the
 * settler also use and which the Rust test vectors pin (I-23). This module
 * adds the hex boundary used by stored rows, ed25519 verification, and the
 * acceptor key, which is read only after the network guard.
 */
import { ConvexError } from 'convex/values'
import { Keypair, StrKey, hash } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  acceptancePayloadBytes,
  merkleRoot,
  publicKeyOf,
  receiptLeaf,
  signEd25519,
  voucherPayloadBytes,
  type TipReceiptFields,
  type VoucherFields,
} from '../../../lib/stellar/v2/tab/encoding'
import { assertBackendTestnet } from '../networkGuard'
import { bytesToHex, hexToBytes, isHexOfLength } from './ids'

export {
  acceptancePayloadBytes,
  merkleRoot,
  receiptLeaf,
  voucherPayloadBytes,
  type TipReceiptFields,
  type VoucherFields,
}

/** At most this many receipts per `(reader, key_id, writer)` (section 3.6). */
export const MAX_RECEIPTS_PER_PAIR = 256

/** A tip receipt in stored form: integers as decimal strings, bytes as hex. */
export type StoredReceipt = {
  amount: string
  articleId: string
  clientRef: string
  contentHash: string
  cumulativeAfter: string
  highlightId: string | null
  seq: number
}

export function receiptFields(r: StoredReceipt): TipReceiptFields {
  return {
    amount: BigInt(r.amount),
    articleId: hexToBytes(r.articleId),
    clientRef: hexToBytes(r.clientRef),
    contentHash: hexToBytes(r.contentHash),
    cumulativeAfter: BigInt(r.cumulativeAfter),
    highlightId: r.highlightId === null ? null : hexToBytes(r.highlightId),
    seq: r.seq,
  }
}

/** Leaf hash of a stored receipt, lowercase hex. */
export function receiptLeafHex(r: StoredReceipt): string {
  return bytesToHex(receiptLeaf(receiptFields(r)))
}

/** Merkle root over leaf hashes in `seq` order, lowercase hex. */
export function receiptsRootHex(leafHashes: string[]): string {
  return bytesToHex(merkleRoot(leafHashes.map(hexToBytes)))
}

/** `network_id`: SHA-256 of the network passphrase. */
export function networkIdOf(passphrase: string): Uint8Array {
  return new Uint8Array(hash(Buffer.from(passphrase, 'utf8')))
}

/** True when `signature` is a valid ed25519 signature of `message`. */
export function verifyEd25519(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string
): boolean {
  if (!isHexOfLength(publicKeyHex, 32) || !isHexOfLength(signatureHex, 64)) {
    return false
  }
  try {
    const keypair = Keypair.fromPublicKey(
      StrKey.encodeEd25519PublicKey(Buffer.from(hexToBytes(publicKeyHex)))
    )
    return keypair.verify(
      Buffer.from(message),
      Buffer.from(hexToBytes(signatureHex))
    )
  } catch {
    return false
  }
}

export type Acceptor = {
  /** ed25519 public key, lowercase hex. */
  publicKey: string
  /** Signs the acceptance payload of a voucher payload. Hex signature. */
  sign: (voucherPayload: Uint8Array) => string
}

type EnvLike = Record<string, string | undefined>

function acceptorUnavailable(message: string): never {
  throw new ConvexError({ code: 'TAB_ACCEPTOR_UNAVAILABLE', message })
}

/** Parses a Stellar secret seed (`S…`) or 64 hex characters into a raw seed. */
export function parseAcceptorSeed(secret: string): Uint8Array {
  const value = secret.trim()
  if (StrKey.isValidEd25519SecretSeed(value)) {
    return new Uint8Array(Keypair.fromSecret(value).rawSecretKey())
  }
  if (isHexOfLength(value.toLowerCase(), 32)) {
    return hexToBytes(value)
  }
  return acceptorUnavailable('TAB_ACCEPTOR_SECRET is not a valid ed25519 seed.')
}

/**
 * The acceptor key. Runs the network guard and requires
 * `SETTLEMENT_ENABLED=true` before the secret is read (section 6.3, guard
 * rules). It does not call `assertNonProductionBackend`: acceptance runs
 * wherever tab tips are accepted.
 */
export function loadAcceptor(env: EnvLike = process.env): Acceptor {
  assertBackendTestnet(env)
  if (env.SETTLEMENT_ENABLED?.trim() !== 'true') {
    acceptorUnavailable('Tab acceptance is not enabled on this deployment.')
  }
  const secret = env.TAB_ACCEPTOR_SECRET
  if (!secret?.trim()) acceptorUnavailable('TAB_ACCEPTOR_SECRET is not set.')
  const seed = parseAcceptorSeed(secret)
  return {
    publicKey: bytesToHex(publicKeyOf(seed)),
    sign: (voucherPayload) =>
      bytesToHex(signEd25519(seed, acceptancePayloadBytes(voucherPayload))),
  }
}
