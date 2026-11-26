/**
 * Typed builders for a tab tip voucher (docs/architecture/v2/03-tab-contract.md,
 * section 3.4; 05-flows-and-admin.md, section 5.6).
 *
 * The types mirror `tabs.prepareTip` and `tabs.submitTip` in Convex. The id
 * type parameter lets a caller keep Convex's `Id<'tips'> | Id<'highlightTips'>`.
 */
import { StrKey } from '@stellar/stellar-sdk'

import { bytesToHex, hexToBytes, isHexOfLength, parseAmount } from './bytes'
import { TabEncodingError, sha256, voucherPayloadBytes } from './encoding'
import { TabClientError } from './errors'
import {
  MAX_RECEIPTS_PER_PAIR,
  appendLeaf,
  receiptLeafHex,
  type StoredReceipt,
} from './merkle'

/** `tabs.prepareTip` result (`PreparedTabTip` in `convex/lib/chain/tabLedger.ts`). */
export type PreparedTabTip<Id extends string = string> = {
  prepareId: Id
  tabContractId: string
  readerAddress: string
  writer: string
  keyId: number
  seq: number
  cumulativeBefore: string
  amount: string
  receipt: StoredReceipt
  /** Leaf hashes of seq 1 to `seq − 1`, in order. */
  leafHashes: string[]
  /** Unix ms; submit before this. */
  expiresAt: number
  existing: boolean
}

/** `tabs.submitTip` arguments. */
export type SubmitTipArgs<Id extends string = string> = {
  prepareId: Id
  receipt: StoredReceipt
  /** 64-byte ed25519 signature, lowercase hex. */
  signature: string
}

/** The countersigned voucher in `tabs.submitTip`'s result. */
export type AcceptedVoucher = {
  tabContractId: string
  reader: string
  writer: string
  keyId: number
  publicKey: string
  cumulative: string
  receiptsRoot: string
  signature: string
  acceptor: string
  acceptanceSignature: string
}

/** `tabs.submitTip` result. */
export type SubmittedTabTip = {
  status: 'ACCEPTED'
  receiptId: string
  receipt: StoredReceipt
  leafHashes: string[]
  voucher: AcceptedVoucher
  alreadyAccepted: boolean
}

/** `network_id`: SHA-256 of the network passphrase. */
export function networkIdOf(passphrase: string): Uint8Array {
  return sha256(new TextEncoder().encode(passphrase))
}

function isAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
  )
}

/** Why a prepared tip cannot be signed. None of these marks the key. */
export type PrepareProblem =
  | 'wrong_tab'
  | 'wrong_reader'
  | 'malformed'
  | 'inconsistent'
  | 'pair_full'
  | 'expired'
  | 'above_limit'

export class PrepareCheckError extends Error {
  readonly problem: PrepareProblem

  constructor(problem: PrepareProblem, message: string) {
    super(message)
    this.name = 'PrepareCheckError'
    this.problem = problem
  }
}

export type PrepareExpectations = {
  tabContractId: string
  readerAddress: string
  /** Unix ms; defaults to `Date.now()`. */
  now?: number
  /** Refuse to sign a single tip above this many base units. */
  maxAmount?: bigint
}

/**
 * Checks a prepared tip and returns the receipt this client builds from it.
 *
 * The receipt is rebuilt from `seq`, `amount` and `cumulativeBefore`, and the
 * server's `receipt` must match it field for field. The Merkle and ledger
 * checks happen separately (`local-ledger.ts`).
 */
export function buildReceipt<Id extends string>(
  prepared: PreparedTabTip<Id>,
  expect: PrepareExpectations
): StoredReceipt {
  const fail = (problem: PrepareProblem, message: string): never => {
    throw new PrepareCheckError(problem, message)
  }
  if (prepared.tabContractId !== expect.tabContractId)
    fail('wrong_tab', 'The prepared tip names another Tab contract.')
  if (prepared.readerAddress !== expect.readerAddress)
    fail('wrong_reader', 'The prepared tip names another reader.')
  if (!isAddress(prepared.writer))
    fail('malformed', 'The writer address is not valid.')
  if (
    !Number.isInteger(prepared.keyId) ||
    prepared.keyId < 0 ||
    prepared.keyId > 0xffff_ffff
  )
    fail('malformed', 'keyId must be a u32.')
  if (
    !Array.isArray(prepared.leafHashes) ||
    !prepared.leafHashes.every((h) => isHexOfLength(h, 32))
  )
    fail('malformed', 'leafHashes must be 32-byte hex values.')
  if (!Number.isInteger(prepared.seq) || prepared.seq < 1)
    fail('malformed', 'seq must be a positive integer.')
  if (prepared.seq !== prepared.leafHashes.length + 1)
    fail('inconsistent', 'seq does not follow the earlier leaves.')
  if (prepared.seq > MAX_RECEIPTS_PER_PAIR)
    fail('pair_full', 'This key has reached its receipt limit for the writer.')

  let amount: bigint
  let before: bigint
  try {
    amount = parseAmount(prepared.amount, 'amount')
    before = parseAmount(prepared.cumulativeBefore, 'cumulativeBefore')
  } catch (error) {
    if (!(error instanceof TabClientError)) throw error
    return fail('malformed', 'amount and cumulativeBefore must be integers.')
  }
  if (amount <= BigInt(0)) fail('malformed', 'amount must be positive.')
  if (expect.maxAmount !== undefined && amount > expect.maxAmount)
    fail('above_limit', 'The tip is above the limit this page allows.')
  if (
    typeof prepared.expiresAt !== 'number' ||
    (expect.now ?? Date.now()) >= prepared.expiresAt
  )
    fail('expired', 'The prepared tip expired. Prepare it again.')

  const server = prepared.receipt
  const receipt: StoredReceipt = {
    amount: amount.toString(),
    // Bytes fields are taken verbatim: submitTip compares them as strings.
    articleId: String(server?.articleId ?? ''),
    clientRef: String(server?.clientRef ?? ''),
    contentHash: String(server?.contentHash ?? ''),
    cumulativeAfter: (before + amount).toString(),
    highlightId: server?.highlightId == null ? null : server.highlightId,
    seq: prepared.seq,
  }
  try {
    // Parses every field and length.
    receiptLeafHex(receipt)
  } catch (error) {
    // Anything else (a missing runtime global, say) is not the server's fault.
    if (!(error instanceof TabClientError || error instanceof TabEncodingError))
      throw error
    fail('malformed', 'The receipt fields are not valid.')
  }
  if (
    server.amount !== receipt.amount ||
    server.cumulativeAfter !== receipt.cumulativeAfter ||
    server.seq !== receipt.seq
  )
    fail('inconsistent', 'The receipt does not match the prepared amounts.')
  return receipt
}

export type VoucherInput = {
  tabContractId: string
  networkPassphrase: string
  reader: string
  writer: string
  keyId: number
  /** 32-byte session public key. */
  publicKey: Uint8Array
  cumulative: string
  /** Lowercase hex. */
  receiptsRoot: string
}

/** The exact bytes the session key signs (`encoding.voucherPayloadBytes`). */
export function voucherPayloadFor(v: VoucherInput): Uint8Array {
  return voucherPayloadBytes({
    tab: v.tabContractId,
    networkId: networkIdOf(v.networkPassphrase),
    reader: v.reader,
    writer: v.writer,
    keyId: v.keyId,
    publicKey: v.publicKey,
    cumulative: parseAmount(v.cumulative, 'cumulative'),
    receiptsRoot: hexToBytes(v.receiptsRoot, 32, 'receiptsRoot'),
  })
}

/** The voucher a prepared tip produces, before signing. */
export type UnsignedTabVoucher = {
  receipt: StoredReceipt
  leafHash: string
  /** All of the pair's leaves, seq 1 to n. */
  leafHashes: string[]
  receiptsRoot: string
  cumulative: string
  payload: Uint8Array
}

/**
 * Builds the receipt, the new root over `priorLeafHashes` plus the new leaf,
 * and the payload bytes. `priorLeafHashes` comes from the local ledger check.
 */
export function buildVoucher<Id extends string>(
  prepared: PreparedTabTip<Id>,
  receipt: StoredReceipt,
  input: {
    networkPassphrase: string
    publicKey: Uint8Array
    priorLeafHashes: string[]
  }
): UnsignedTabVoucher {
  const leafHash = receiptLeafHex(receipt)
  const { leafHashes, receiptsRoot } = appendLeaf(
    input.priorLeafHashes,
    leafHash
  )
  const payload = voucherPayloadFor({
    tabContractId: prepared.tabContractId,
    networkPassphrase: input.networkPassphrase,
    reader: prepared.readerAddress,
    writer: prepared.writer,
    keyId: prepared.keyId,
    publicKey: input.publicKey,
    cumulative: receipt.cumulativeAfter,
    receiptsRoot,
  })
  return {
    receipt,
    leafHash,
    leafHashes,
    receiptsRoot,
    cumulative: receipt.cumulativeAfter,
    payload,
  }
}

/** The exact `tabs.submitTip` argument. */
export function submitTipArgs<Id extends string>(
  prepareId: Id,
  receipt: StoredReceipt,
  signature: Uint8Array
): SubmitTipArgs<Id> {
  if (signature.length !== 64)
    throw new TabClientError('INVALID_INPUT', 'signature must be 64 bytes')
  return {
    prepareId,
    receipt: { ...receipt },
    signature: bytesToHex(signature),
  }
}
