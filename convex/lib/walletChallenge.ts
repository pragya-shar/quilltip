/**
 * Proof that a user controls a Stellar address before it is linked to their
 * account. Pure functions: the challenge text, the fallback transaction and
 * signature checks. `convex/walletLink.ts` stores and consumes challenges.
 *
 * Two proofs are accepted, both over the same stored challenge:
 *
 * 1. Message (SEP-53). The wallet signs `challengeMessage(...)`. The signature
 *    covers `SHA-256("Stellar Signed Message:\n" + message)`, checked with
 *    `Keypair.verifyMessage` from the Stellar SDK.
 * 2. Transaction, for wallets that cannot sign messages (Albedo, Rabet). The
 *    wallet signs `challengeTransaction(...)`: source = the address, sequence
 *    number 0, three `manageData` operations carrying the nonce, origin and
 *    user, and time bounds equal to the challenge lifetime. The server
 *    rebuilds that transaction from the stored challenge and checks the
 *    signature over its hash, so the wallet cannot change what it proves.
 *    Sequence number 0 is below every account's sequence number, so the
 *    network rejects the transaction if it is ever submitted: it can move
 *    nothing.
 *
 * Both bind the address, the Quilltip user, the network passphrase, the site
 * origin and a single-use nonce.
 */

import {
  Account,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000
export const WALLET_CHALLENGE_NONCE_BYTES = 16
/** Fee in stroops on the fallback transaction. It is never submitted. */
const FALLBACK_FEE = '100'

export type WalletChallengeFields = {
  address: string
  userId: string
  networkPassphrase: string
  origin: string
  /** Lower-case hex, WALLET_CHALLENGE_NONCE_BYTES bytes. */
  nonce: string
  issuedAt: number
  expiresAt: number
}

export type WalletProof =
  | { kind: 'message'; signature: string }
  | { kind: 'transaction'; signedXdr: string }

export type ProofCheck =
  | { ok: true }
  | { ok: false; reason: 'SIGNATURE_INVALID' | 'TRANSACTION_CHANGED' }

export function isValidAccountAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address)
}

export function newNonce(): string {
  const bytes = new Uint8Array(WALLET_CHALLENGE_NONCE_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The site origin, normalised (scheme, host and port only). */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/** The text a wallet signs for the message proof. Stable for a challenge. */
export function challengeMessage(fields: WalletChallengeFields): string {
  return [
    'QuillTip asks you to prove you control this Stellar account.',
    '',
    `Account: ${fields.address}`,
    `QuillTip user: ${fields.userId}`,
    `Network: ${fields.networkPassphrase}`,
    `Site: ${fields.origin}`,
    `Nonce: ${fields.nonce}`,
    `Issued: ${new Date(fields.issuedAt).toISOString()}`,
    `Expires: ${new Date(fields.expiresAt).toISOString()}`,
    '',
    'Signing this message does not move funds or submit a transaction.',
  ].join('\n')
}

/** The fallback transaction. Deterministic for a challenge. */
export function challengeTransaction(
  fields: WalletChallengeFields
): Transaction {
  // Sequence "-1" makes the built transaction use sequence number 0.
  const source = new Account(fields.address, '-1')
  const host = new URL(fields.origin).host
  return new TransactionBuilder(source, {
    fee: FALLBACK_FEE,
    networkPassphrase: fields.networkPassphrase,
    timebounds: {
      minTime: Math.floor(fields.issuedAt / 1000),
      maxTime: Math.ceil(fields.expiresAt / 1000),
    },
  })
    .addOperation(
      Operation.manageData({
        name: 'quilltip wallet link',
        value: fields.nonce,
      })
    )
    .addOperation(
      Operation.manageData({ name: 'quilltip origin', value: host })
    )
    .addOperation(
      Operation.manageData({ name: 'quilltip user', value: fields.userId })
    )
    .build()
}

/** Base64 (SEP-53 wallets) or hex signature bytes; null if neither is 64 bytes. */
export function decodeSignature(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    const out = new Uint8Array(64)
    for (let i = 0; i < 64; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
  try {
    const binary = atob(trimmed)
    if (binary.length !== 64) return null
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/** Checks a proof against the stored challenge fields. */
export function checkWalletProof(
  fields: WalletChallengeFields,
  proof: WalletProof
): ProofCheck {
  const key = Keypair.fromPublicKey(fields.address)
  if (proof.kind === 'message') {
    const signature = decodeSignature(proof.signature)
    if (!signature) return { ok: false, reason: 'SIGNATURE_INVALID' }
    try {
      return key.verifyMessage(challengeMessage(fields), signature)
        ? { ok: true }
        : { ok: false, reason: 'SIGNATURE_INVALID' }
    } catch {
      return { ok: false, reason: 'SIGNATURE_INVALID' }
    }
  }

  const expected = challengeTransaction(fields)
  let signed: Transaction
  try {
    const parsed = TransactionBuilder.fromXDR(
      proof.signedXdr,
      fields.networkPassphrase
    )
    if (!('operations' in parsed) || 'innerTransaction' in parsed) {
      return { ok: false, reason: 'TRANSACTION_CHANGED' }
    }
    signed = parsed as Transaction
  } catch {
    return { ok: false, reason: 'TRANSACTION_CHANGED' }
  }
  // The signed body must be exactly the challenge transaction.
  if (!bytesEqual(signed.hash(), expected.hash())) {
    return { ok: false, reason: 'TRANSACTION_CHANGED' }
  }
  const hash = expected.hash()
  const hint = key.signatureHint()
  const valid = signed.signatures.some(
    (s) =>
      bytesEqual(s.hint.toBytes(), hint) &&
      key.verify(hash, s.signature.toBytes())
  )
  return valid ? { ok: true } : { ok: false, reason: 'SIGNATURE_INVALID' }
}
