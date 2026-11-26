/**
 * The browser tab modules reproduce the shared vectors byte for byte (I-23):
 * receipt XDR, leaf, root, voucher payload and session signature, through
 * the real key store and `signTabTip`, for both key backends.
 */
import { describe, expect, it } from 'vitest'

import shared from '../../contracts/shared/test-vectors.json'
import tab from '../../contracts/tab/test-vectors.json'
import { bytesToHex, hexToBytes } from '../../lib/stellar/v2/tab/bytes'
import { tipReceiptBytes } from '../../lib/stellar/v2/tab/encoding'
import {
  commitAcceptedTip,
  networkIdOf,
  receiptFields,
  receiptLeafHex,
  receiptProofHex,
  receiptsRootHex,
  signTabTip,
  verifyReceiptHex,
  voucherPayloadFor,
  type PreparedTabTip,
  type StoredReceipt,
} from '../../lib/stellar/v2/tab'
import { PASSPHRASE, SESSION_SEED, depsFor, freshDb, plantKey } from './helpers'

const items: StoredReceipt[] = shared.receipts.items.map((r) => ({
  amount: r.amount,
  articleId: r.article_id,
  clientRef: r.client_ref,
  contentHash: r.content_hash,
  cumulativeAfter: r.cumulative_after,
  highlightId: r.highlight_id,
  seq: r.seq,
}))

describe('receipts and root (shared vectors)', () => {
  it('network id is SHA-256 of the passphrase', () => {
    expect(bytesToHex(networkIdOf(PASSPHRASE))).toBe(shared.network.network_id)
  })

  it('receipt XDR and leaves', () => {
    items.forEach((receipt, i) => {
      const item = shared.receipts.items[i]!
      expect(bytesToHex(tipReceiptBytes(receiptFields(receipt)))).toBe(item.xdr)
      expect(receiptLeafHex(receipt)).toBe(item.leaf)
    })
  })

  it('roots and proofs', () => {
    const leaves = shared.receipts.items.map((i) => i.leaf)
    for (const r of shared.receipts.roots)
      expect(receiptsRootHex(leaves.slice(0, r.count))).toBe(r.root)
    for (const p of shared.receipts.proofs) {
      const subset = leaves.slice(0, p.count)
      expect(receiptProofHex(subset, p.index)).toEqual(p.proof)
      expect(
        verifyReceiptHex(items[p.index]!, p.proof, receiptsRootHex(subset))
      ).toBe(true)
      const tampered = { ...items[p.index]!, amount: '1' }
      expect(verifyReceiptHex(tampered, p.proof, receiptsRootHex(subset))).toBe(
        false
      )
    }
  })

  it('tab settlement steps: payload and signature from the stored key', async () => {
    for (const backend of ['webcrypto', 'noble'] as const) {
      const db = freshDb()
      const scope = {
        tabContractId: tab.tab_contract,
        readerAddress: tab.reader,
      }
      await plantKey(db, scope, SESSION_SEED, backend, [tab.key_id])
      const deps = depsFor(db)
      const key = (await deps.keys.get(scope, tab.key_id))!
      expect(bytesToHex(key.publicKey())).toBe(tab.session_public_key)
      for (const step of tab.steps) {
        const payload = voucherPayloadFor({
          tabContractId: tab.tab_contract,
          networkPassphrase: PASSPHRASE,
          reader: tab.reader,
          writer: tab.writer,
          keyId: tab.key_id,
          publicKey: key.publicKey(),
          cumulative: step.cumulative,
          receiptsRoot: step.receipts_root,
        })
        expect(bytesToHex(payload)).toBe(step.payload_xdr)
        expect(bytesToHex(await key.sign(payload))).toBe(step.signature)
      }
    }
  })
})

describe('signTabTip reproduces each shared voucher (G/G, G/C, C/C)', () => {
  for (const voucher of shared.vouchers) {
    for (const backend of ['webcrypto', 'noble'] as const) {
      it(`${voucher.case} with a ${backend} key`, async () => {
        const db = freshDb()
        const scope = {
          tabContractId: shared.tab_contract,
          readerAddress: voucher.reader,
        }
        await plantKey(db, scope, SESSION_SEED, backend, [voucher.key_id])
        const deps = depsFor(db, { readerAddress: voucher.reader })
        const leaves: string[] = []
        let last
        for (const receipt of items) {
          const prepared: PreparedTabTip = {
            prepareId: `prep_${receipt.seq}`,
            tabContractId: shared.tab_contract,
            readerAddress: voucher.reader,
            writer: voucher.writer,
            keyId: voucher.key_id,
            seq: receipt.seq,
            cumulativeBefore: (
              BigInt(receipt.cumulativeAfter) - BigInt(receipt.amount)
            ).toString(),
            amount: receipt.amount,
            receipt,
            leafHashes: [...leaves],
            expiresAt: 10_000,
            existing: false,
          }
          last = await signTabTip(prepared, deps)
          expect(last.kind).toBe('signed')
          if (last.kind !== 'signed') return
          expect(last.submit.receipt).toEqual(receipt)
          leaves.push(receiptLeafHex(receipt))
          expect(last.voucher.leafHashes).toEqual(leaves)
          expect(last.voucher.receiptsRoot).toBe(
            shared.receipts.roots[receipt.seq - 1]!.root
          )
          await commitAcceptedTip(
            {
              status: 'ACCEPTED',
              receiptId: `r${receipt.seq}`,
              receipt,
              leafHashes: [...leaves],
              voucher: {
                tabContractId: shared.tab_contract,
                reader: voucher.reader,
                writer: voucher.writer,
                keyId: voucher.key_id,
                publicKey: shared.keys.session.public_key,
                cumulative: receipt.cumulativeAfter,
                receiptsRoot: last.voucher.receiptsRoot,
                signature: last.submit.signature,
                acceptor: shared.keys.acceptor.public_key,
                acceptanceSignature: '00'.repeat(64),
              },
              alreadyAccepted: false,
            },
            deps
          )
        }
        if (last?.kind !== 'signed') throw new Error('not signed')
        expect(last.voucher.cumulative).toBe(voucher.cumulative)
        expect(last.voucher.receiptsRoot).toBe(voucher.receipts_root)
        expect(last.submit.signature).toBe(voucher.signature)
        const payload = voucherPayloadFor({
          tabContractId: shared.tab_contract,
          networkPassphrase: PASSPHRASE,
          reader: voucher.reader,
          writer: voucher.writer,
          keyId: voucher.key_id,
          publicKey: hexToBytes(shared.keys.session.public_key, 32),
          cumulative: last.voucher.cumulative,
          receiptsRoot: last.voucher.receiptsRoot,
        })
        expect(bytesToHex(payload)).toBe(voucher.payload_xdr)
        expect(payload.length).toBe(voucher.payload_length)
      })
    }
  }
})
