/**
 * Tab voucher, acceptance and receipt encoders
 * (docs/architecture/v2/03-tab-contract.md, sections 3.4 and 3.6).
 *
 * The signed bytes are the XDR of an `ScVal::Map` whose `Symbol` keys are in
 * ascending order, exactly as `soroban_sdk::xdr::ToXdr` encodes the
 * `#[contracttype]` structs in `contracts/shared/src/payload.rs`. The maps are
 * built explicitly here, never through generic conversion, so the key order
 * and value types are fixed. `contracts/shared/test-vectors.json` and
 * `contracts/tab/test-vectors.json` pin the expected bytes.
 *
 * Runs in the browser, the Convex default runtime and Node. `Buffer` is
 * imported, not taken from the global scope: browser bundles and the Convex
 * default runtime have no global `Buffer`.
 */
import { Address, Keypair, hash, xdr } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'

export const TAB_DOMAIN = 'quilltip_tab_v1'
export const TAB_ACCEPT_DOMAIN = 'quilltip_tab_accept_v1'

export type VoucherFields = {
  /** The Tab contract (`C…`). */
  tab: string
  /** SHA-256 of the network passphrase, 32 bytes. */
  networkId: Uint8Array
  reader: string
  writer: string
  keyId: number
  /** The session key's ed25519 public key, 32 bytes. */
  publicKey: Uint8Array
  cumulative: bigint
  /** 32 bytes. */
  receiptsRoot: Uint8Array
}

export type TipReceiptFields = {
  amount: bigint
  articleId: Uint8Array
  clientRef: Uint8Array
  contentHash: Uint8Array
  cumulativeAfter: bigint
  highlightId: Uint8Array | null
  seq: number
}

export class TabEncodingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TabEncodingError'
  }
}

function fixed(bytes: Uint8Array, length: number, name: string): xdr.ScVal {
  if (bytes.length !== length) {
    throw new TabEncodingError(
      `${name} must be ${length} bytes, got ${bytes.length}`
    )
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes))
}

const ONE = BigInt(1)
const BITS_64 = BigInt(64)
const BITS_127 = BigInt(127)
const I128_MIN = -(ONE << BITS_127)
const I128_MAX = (ONE << BITS_127) - ONE
const U64_MASK = (ONE << BITS_64) - ONE

function i128(value: bigint, name: string): xdr.ScVal {
  if (value < I128_MIN || value > I128_MAX) {
    throw new TabEncodingError(`${name} is out of i128 range`)
  }
  const unsigned = BigInt.asUintN(128, value)
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(
        BigInt.asIntN(64, unsigned >> BITS_64).toString()
      ),
      lo: xdr.Uint64.fromString((unsigned & U64_MASK).toString()),
    })
  )
}

function u32(value: number, name: string): xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TabEncodingError(`${name} must be a u32`)
  }
  return xdr.ScVal.scvU32(value)
}

/** A map entry list in ascending key order, as `#[contracttype]` encodes it. */
function sortedMap(entries: [string, xdr.ScVal][]): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return xdr.ScVal.scvMap(
    sorted.map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
    )
  )
}

function toBytes(value: xdr.ScVal): Uint8Array {
  return new Uint8Array(value.toXdr())
}

/** The exact bytes a session key signs (no pre-hash). */
export function voucherPayloadBytes(v: VoucherFields): Uint8Array {
  return toBytes(
    sortedMap([
      ['cumulative', i128(v.cumulative, 'cumulative')],
      ['domain', xdr.ScVal.scvSymbol(TAB_DOMAIN)],
      ['key_id', u32(v.keyId, 'keyId')],
      ['network_id', fixed(v.networkId, 32, 'networkId')],
      ['public_key', fixed(v.publicKey, 32, 'publicKey')],
      ['reader', new Address(v.reader).toScVal()],
      ['receipts_root', fixed(v.receiptsRoot, 32, 'receiptsRoot')],
      ['tab', new Address(v.tab).toScVal()],
      ['writer', new Address(v.writer).toScVal()],
    ])
  )
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(hash(Buffer.from(bytes)))
}

/** The exact bytes the acceptor key signs for a voucher payload. */
export function acceptancePayloadBytes(voucherBytes: Uint8Array): Uint8Array {
  return toBytes(
    sortedMap([
      ['domain', xdr.ScVal.scvSymbol(TAB_ACCEPT_DOMAIN)],
      ['payload_hash', fixed(sha256(voucherBytes), 32, 'payloadHash')],
    ])
  )
}

/** XDR of a tip receipt. */
export function tipReceiptBytes(r: TipReceiptFields): Uint8Array {
  return toBytes(
    sortedMap([
      ['amount', i128(r.amount, 'amount')],
      ['article_id', fixed(r.articleId, 32, 'articleId')],
      ['client_ref', fixed(r.clientRef, 16, 'clientRef')],
      ['content_hash', fixed(r.contentHash, 32, 'contentHash')],
      ['cumulative_after', i128(r.cumulativeAfter, 'cumulativeAfter')],
      [
        'highlight_id',
        r.highlightId === null
          ? xdr.ScVal.scvVoid()
          : fixed(r.highlightId, 32, 'highlightId'),
      ],
      ['seq', u32(r.seq, 'seq')],
    ])
  )
}

/** `SHA-256(SHA-256(xdr(receipt)))`. */
export function receiptLeaf(r: TipReceiptFields): Uint8Array {
  return sha256(sha256(tipReceiptBytes(r)))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x - y
  }
  return a.length - b.length
}

/** OpenZeppelin `commutative_hash_pair`: SHA-256 of the sorted concatenation. */
export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a]
  const joined = new Uint8Array(64)
  joined.set(lo, 0)
  joined.set(hi, 32)
  return sha256(joined)
}

function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i] as Uint8Array
    const right = level[i + 1]
    out.push(right ? hashPair(left, right) : left)
  }
  return out
}

/** Merkle root of leaves in `seq` order; an odd last node is carried up. */
export function merkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0)
    throw new TabEncodingError('merkleRoot needs at least one leaf')
  let level = leaves
  while (level.length > 1) level = nextLevel(level)
  return level[0] as Uint8Array
}

/** Sibling hashes from the leaf at `index` up to the root. */
export function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (index < 0 || index >= leaves.length)
    throw new TabEncodingError('index out of range')
  const proof: Uint8Array[] = []
  let level = leaves
  let i = index
  while (level.length > 1) {
    const sibling = level[i ^ 1]
    if (sibling) proof.push(sibling)
    level = nextLevel(level)
    i = Math.floor(i / 2)
  }
  return proof
}

/**
 * Checks a receipt against a root. The leaf is always recomputed from the
 * receipt; a leaf hash supplied by someone else is never accepted.
 */
export function verifyReceipt(
  r: TipReceiptFields,
  proof: Uint8Array[],
  root: Uint8Array
): boolean {
  let node = receiptLeaf(r)
  for (const sibling of proof) node = hashPair(node, sibling)
  return compareBytes(node, root) === 0
}

/** Signs bytes with an ed25519 seed (session or acceptor key). */
export function signEd25519(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return new Uint8Array(
    Keypair.fromRawEd25519Seed(Buffer.from(seed)).sign(Buffer.from(message))
  )
}

/** The public key of an ed25519 seed. */
export function publicKeyOf(seed: Uint8Array): Uint8Array {
  return new Uint8Array(
    Keypair.fromRawEd25519Seed(Buffer.from(seed)).rawPublicKey()
  )
}
