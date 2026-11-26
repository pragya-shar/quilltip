/**
 * The TypeScript Tab encoders reproduce the Rust vectors byte for byte (I-23).
 *
 * - `contracts/shared/test-vectors.json`: voucher and acceptance payloads for
 *   G/G, G/C and C/C, both signatures, receipt XDR and leaves, Merkle roots
 *   and proofs.
 * - `contracts/tab/test-vectors.json`: a settlement sequence signed by the
 *   contract's own `voucher_payload` output.
 */
import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'

import shared from '../../contracts/shared/test-vectors.json'
import tab from '../../contracts/tab/test-vectors.json'
import {
  TabEncodingError,
  acceptancePayloadBytes,
  merkleProof,
  merkleRoot,
  publicKeyOf,
  receiptLeaf,
  signEd25519,
  tipReceiptBytes,
  verifyReceipt,
  voucherPayloadBytes,
  type TipReceiptFields,
} from '../../lib/stellar/v2/tab/encoding'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const bytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))

const sessionSeed = bytes(shared.keys.session.seed)
const acceptorSeed = bytes(shared.keys.acceptor.seed)
const networkId = bytes(shared.network.network_id)

const receipts: TipReceiptFields[] = shared.receipts.items.map((r) => ({
  amount: BigInt(r.amount),
  articleId: bytes(r.article_id),
  clientRef: bytes(r.client_ref),
  contentHash: bytes(r.content_hash),
  cumulativeAfter: BigInt(r.cumulative_after),
  highlightId: r.highlight_id === null ? null : bytes(r.highlight_id),
  seq: r.seq,
}))

describe('keys', () => {
  it('derive the vector public keys from the seeds', () => {
    expect(hex(publicKeyOf(sessionSeed))).toBe(shared.keys.session.public_key)
    expect(hex(publicKeyOf(acceptorSeed))).toBe(shared.keys.acceptor.public_key)
  })
})

describe('voucher and acceptance payloads (shared vectors)', () => {
  for (const v of shared.vouchers) {
    it(`${v.case}: payload, acceptance and both signatures`, () => {
      const payload = voucherPayloadBytes({
        tab: shared.tab_contract,
        networkId,
        reader: v.reader,
        writer: v.writer,
        keyId: v.key_id,
        publicKey: publicKeyOf(sessionSeed),
        cumulative: BigInt(v.cumulative),
        receiptsRoot: bytes(v.receipts_root),
      })
      expect(hex(payload)).toBe(v.payload_xdr)
      expect(payload.length).toBe(v.payload_length)
      const accept = acceptancePayloadBytes(payload)
      expect(hex(accept)).toBe(v.acceptance_payload_xdr)
      expect(hex(signEd25519(sessionSeed, payload))).toBe(v.signature)
      expect(hex(signEd25519(acceptorSeed, accept))).toBe(
        v.acceptance_signature
      )
    })
  }
})

describe('settlement sequence (tab vectors)', () => {
  for (const step of tab.steps) {
    it(`step ${step.step}: cumulative ${step.cumulative}`, () => {
      const payload = voucherPayloadBytes({
        tab: tab.tab_contract,
        networkId: bytes(tab.network_id),
        reader: tab.reader,
        writer: tab.writer,
        keyId: tab.key_id,
        publicKey: bytes(tab.session_public_key),
        cumulative: BigInt(step.cumulative),
        receiptsRoot: bytes(step.receipts_root),
      })
      expect(hex(payload)).toBe(step.payload_xdr)
      expect(hex(signEd25519(sessionSeed, payload))).toBe(step.signature)
      const accept = acceptancePayloadBytes(payload)
      expect(hex(accept)).toBe(step.acceptance_payload_xdr)
      expect(hex(signEd25519(acceptorSeed, accept))).toBe(
        step.acceptance_signature
      )
    })
  }
})

describe('receipts and Merkle tree', () => {
  it('encodes each receipt and its leaf', () => {
    shared.receipts.items.forEach((item, i) => {
      const receipt = receipts[i]!
      expect(hex(tipReceiptBytes(receipt))).toBe(item.xdr)
      expect(hex(receiptLeaf(receipt))).toBe(item.leaf)
    })
  })

  it('builds every root and proof, and proofs verify against recomputed leaves', () => {
    const leaves = receipts.map(receiptLeaf)
    for (const r of shared.receipts.roots) {
      expect(hex(merkleRoot(leaves.slice(0, r.count)))).toBe(r.root)
    }
    for (const p of shared.receipts.proofs) {
      const subset = leaves.slice(0, p.count)
      const proof = merkleProof(subset, p.index)
      expect(proof.map(hex)).toEqual(p.proof)
      const receipt = receipts[p.index]!
      expect(verifyReceipt(receipt, proof, merkleRoot(subset))).toBe(true)
      const tampered = { ...receipt, amount: receipt.amount + BigInt(1) }
      expect(verifyReceipt(tampered, proof, merkleRoot(subset))).toBe(false)
    }
  })
})

describe('input validation', () => {
  const base = {
    tab: shared.tab_contract,
    networkId,
    reader: shared.vouchers[0]!.reader,
    writer: shared.vouchers[0]!.writer,
    keyId: 0,
    publicKey: publicKeyOf(sessionSeed),
    cumulative: BigInt(1),
    receiptsRoot: new Uint8Array(32),
  }
  it('refuses wrong lengths and out-of-range numbers', () => {
    expect(() =>
      voucherPayloadBytes({ ...base, networkId: new Uint8Array(31) })
    ).toThrow(TabEncodingError)
    expect(() => voucherPayloadBytes({ ...base, keyId: -1 })).toThrow(
      TabEncodingError
    )
    expect(() =>
      voucherPayloadBytes({ ...base, cumulative: BigInt(1) << BigInt(127) })
    ).toThrow(TabEncodingError)
    expect(() => merkleRoot([])).toThrow(TabEncodingError)
  })
  it('encodes negative and maximal i128 values', () => {
    expect(() =>
      voucherPayloadBytes({ ...base, cumulative: -(BigInt(1) << BigInt(127)) })
    ).not.toThrow()
    expect(() =>
      voucherPayloadBytes({
        ...base,
        cumulative: (BigInt(1) << BigInt(127)) - BigInt(1),
      })
    ).not.toThrow()
  })
})
