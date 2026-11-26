/**
 * Receipts and the receipts root, in the hex form Convex stores
 * (docs/architecture/v2/03-tab-contract.md, section 3.6). The bytes come from
 * the shared encoder in `encoding.ts`; this module only adds the hex
 * boundary and input checks.
 */
import { bytesToHex, hexToBytes, isHexOfLength, parseAmount } from './bytes'
import {
  merkleProof,
  merkleRoot,
  receiptLeaf,
  verifyReceipt,
  type TipReceiptFields,
} from './encoding'
import { TabClientError } from './errors'

/** At most this many receipts per `(reader, key_id, writer)` (section 3.6). */
export const MAX_RECEIPTS_PER_PAIR = 256

/**
 * A tip receipt as `tabs.prepareTip` returns it and `tabs.submitTip` takes
 * it: integers as decimal strings, bytes as lowercase hex.
 */
export type StoredReceipt = {
  amount: string
  articleId: string
  clientRef: string
  contentHash: string
  cumulativeAfter: string
  highlightId: string | null
  seq: number
}

/** Parses a stored receipt into encoder fields, checking every length. */
export function receiptFields(r: StoredReceipt): TipReceiptFields {
  if (!r || typeof r !== 'object')
    throw new TabClientError('INVALID_INPUT', 'receipt is missing')
  if (!Number.isInteger(r.seq) || r.seq < 1 || r.seq > 0xffff_ffff)
    throw new TabClientError('INVALID_INPUT', 'receipt.seq must be >= 1')
  return {
    amount: parseAmount(r.amount, 'receipt.amount'),
    articleId: hexToBytes(r.articleId, 32, 'receipt.articleId'),
    clientRef: hexToBytes(r.clientRef, 16, 'receipt.clientRef'),
    contentHash: hexToBytes(r.contentHash, 32, 'receipt.contentHash'),
    cumulativeAfter: parseAmount(r.cumulativeAfter, 'receipt.cumulativeAfter'),
    highlightId:
      r.highlightId === null
        ? null
        : hexToBytes(r.highlightId, 32, 'receipt.highlightId'),
    seq: r.seq,
  }
}

/** `SHA-256(SHA-256(xdr(receipt)))`, lowercase hex. */
export function receiptLeafHex(r: StoredReceipt): string {
  return bytesToHex(receiptLeaf(receiptFields(r)))
}

function leafBytes(leafHashes: string[]): Uint8Array[] {
  return leafHashes.map((h, i) => hexToBytes(h, 32, `leafHashes[${i}]`))
}

/** Root over leaf hashes in `seq` order, lowercase hex. */
export function receiptsRootHex(leafHashes: string[]): string {
  if (leafHashes.length === 0)
    throw new TabClientError('INVALID_INPUT', 'a root needs at least one leaf')
  return bytesToHex(merkleRoot(leafBytes(leafHashes)))
}

/**
 * The pair's leaves after appending `newLeaf` to the earlier ones, and their
 * root. `priorLeafHashes` are seq 1 to n − 1 in order.
 */
export function appendLeaf(
  priorLeafHashes: string[],
  newLeaf: string
): { leafHashes: string[]; receiptsRoot: string } {
  if (!isHexOfLength(newLeaf, 32))
    throw new TabClientError('INVALID_INPUT', 'newLeaf must be 32 bytes')
  if (priorLeafHashes.length >= MAX_RECEIPTS_PER_PAIR)
    throw new TabClientError(
      'INVALID_INPUT',
      `a pair holds at most ${MAX_RECEIPTS_PER_PAIR} receipts`
    )
  const leafHashes = [...priorLeafHashes, newLeaf].map((h) => h.toLowerCase())
  return { leafHashes, receiptsRoot: receiptsRootHex(leafHashes) }
}

/** Proof for the receipt at `index` (0-based), as lowercase hex. */
export function receiptProofHex(leafHashes: string[], index: number): string[] {
  return merkleProof(leafBytes(leafHashes), index).map(bytesToHex)
}

/**
 * Checks a receipt against a root. The leaf is recomputed from the receipt;
 * a leaf hash from anyone else is never trusted (section 3.6).
 */
export function verifyReceiptHex(
  receipt: StoredReceipt,
  proof: string[],
  root: string
): boolean {
  try {
    return verifyReceipt(
      receiptFields(receipt),
      proof.map((h, i) => hexToBytes(h, 32, `proof[${i}]`)),
      hexToBytes(root, 32, 'root')
    )
  } catch {
    return false
  }
}
