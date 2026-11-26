/**
 * Vouchers signed by the browser tab library settle on the Tab contract
 * (docs/architecture/v2/05-flows-and-admin.md, sections 5.6 and 5.8).
 *
 * The library runs over fake-indexeddb with Node WebCrypto, once with a
 * WebCrypto key and once with the @noble/curves fallback. The contract's
 * `voucher_payload` view must equal the library bytes; `settle` and
 * `settle_own` must accept library-signed vouchers; a flipped signature bit
 * must be refused. Local network only (see run.ts).
 */
import { join } from 'path'
import { IDBFactory } from 'fake-indexeddb'
import { Keypair, rpc } from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it } from 'vitest'

import { Client as TabClient } from '../../lib/stellar/v2/bindings/tab'
import {
  acceptancePayloadBytes,
  publicKeyOf,
  signEd25519,
} from '../../lib/stellar/v2/tab/encoding'
import {
  commitAcceptedTip,
  createLocalLedger,
  createSessionKeyStore,
  receiptLeafHex,
  receiptsRootHex,
  signTabTip,
  voucherPayloadFor,
  type PreparedTabTip,
  type SignTabTipDeps,
  type StoredReceipt,
} from '../../lib/stellar/v2/tab'
import { Harness, LOCAL_PASSPHRASE, XLM, events } from './harness'

const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const h = new Harness()
const rand = (n: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('hex')
const acceptorSeed = crypto.getRandomValues(new Uint8Array(32))
let admin: Keypair, settler: Keypair, treasury: Keypair
let tabId: string
const tab = (kp: Keypair) => new TabClient(h.opts(tabId, kp))
const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1)

async function send<T>(
  txp: Promise<{
    signAndSend: () => Promise<{
      getTransactionResponse?: rpc.Api.GetTransactionResponse
      result: T
    }>
  }>
) {
  const sent = await (await txp).signAndSend()
  const res = sent.getTransactionResponse
  if (!res || res.status !== rpc.Api.GetTransactionStatus.SUCCESS)
    throw new Error(`failed: ${res?.status}`)
  return {
    res: res as rpc.Api.GetSuccessfulTransactionResponse,
    result: sent.result,
  }
}

beforeAll(async () => {
  expect(wasmDir).not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, settler, treasury] = (await h.accounts(3)) as [
    Keypair,
    Keypair,
    Keypair,
  ]
  const token = h.ensureNativeSac(admin)
  const hash = h.uploadWasm(join(wasmDir, 'quilltip_tab.wasm'), admin)
  tabId = h.deploy(hash, admin, {
    admin: admin.publicKey(),
    pauser: admin.publicKey(),
    upgrader: admin.publicKey(),
    settler: settler.publicKey(),
    token,
    treasury: treasury.publicKey(),
    max_balance: (BigInt(1_000) * XLM).toString(),
    min_deposit: XLM.toString(),
    acceptor_key: Buffer.from(publicKeyOf(acceptorSeed)).toString('hex'),
  })
}, 600_000)

function prepared(
  writer: string,
  reader: string,
  keyId: number,
  seq: number,
  before: bigint,
  amount: bigint,
  leaves: string[]
): PreparedTabTip {
  const receipt: StoredReceipt = {
    amount: amount.toString(),
    articleId: rand(32),
    clientRef: rand(16),
    contentHash: rand(32),
    cumulativeAfter: (before + amount).toString(),
    highlightId: seq === 2 ? rand(32) : null,
    seq,
  }
  return {
    prepareId: `p${seq}_${rand(4)}`,
    tabContractId: tabId,
    readerAddress: reader,
    writer,
    keyId,
    seq,
    cumulativeBefore: before.toString(),
    amount: amount.toString(),
    receipt,
    leafHashes: leaves,
    expiresAt: Date.now() + 300_000,
    existing: false,
  }
}

for (const forceFallback of [false, true]) {
  describe(`${forceFallback ? 'fallback' : 'WebCrypto'} session key`, () => {
    it('library-signed vouchers: payload equals the contract view; settle and settle_own accept them', async () => {
      const [reader, writer] = (await h.accounts(2)) as [Keypair, Keypair]
      const db = { indexedDB: new IDBFactory(), dbName: 'tab-client' }
      const scope = { tabContractId: tabId, readerAddress: reader.publicKey() }
      const keys = createSessionKeyStore({ ...db, forceFallback })
      const key = await keys.generate(scope)
      expect(key.info.backend).toBe(forceFallback ? 'noble' : 'webcrypto')
      const until = (await h.latestLedger()) + 20_000
      const { result: keyId } = await send(
        tab(reader).open_session({
          reader: reader.publicKey(),
          amount: BigInt(20) * XLM,
          public_key: key.publicKey(),
          valid_until: until,
          spend_limit: BigInt(20) * XLM,
        })
      )
      await keys.bindKeyIds(scope, [
        { keyId: keyId as number, publicKey: key.info.publicKey },
      ])
      const deps: SignTabTipDeps = {
        keys,
        ledger: createLocalLedger(db),
        networkPassphrase: LOCAL_PASSPHRASE,
        tabContractId: tabId,
        readerAddress: reader.publicKey(),
      }

      // The contract's payload view equals the library bytes, at the i128 limit too.
      for (const cumulative of [BigInt(1), I128_MAX]) {
        const root = rand(32)
        const view = (
          await tab(reader).voucher_payload({
            reader: reader.publicKey(),
            writer: writer.publicKey(),
            key_id: keyId as number,
            cumulative,
            receipts_root: Buffer.from(root, 'hex'),
          })
        ).result
        expect(Buffer.from(view).toString('hex')).toBe(
          Buffer.from(
            voucherPayloadFor({
              tabContractId: tabId,
              networkPassphrase: LOCAL_PASSPHRASE,
              reader: reader.publicKey(),
              writer: writer.publicKey(),
              keyId: keyId as number,
              publicKey: key.publicKey(),
              cumulative: cumulative.toString(),
              receiptsRoot: root,
            })
          ).toString('hex')
        )
      }

      // Three tips through signTabTip and commitAcceptedTip.
      const leaves: string[] = []
      let cum = BigInt(0)
      let last: { signature: string; root: string } | null = null
      for (let seq = 1; seq <= 3; seq++) {
        const amount = XLM * BigInt(seq)
        const p = prepared(
          writer.publicKey(),
          reader.publicKey(),
          keyId as number,
          seq,
          cum,
          amount,
          [...leaves]
        )
        const r = await signTabTip(p, deps)
        if (r.kind !== 'signed')
          throw new Error(`not signed: ${JSON.stringify(r)}`)
        leaves.push(receiptLeafHex(p.receipt))
        cum += amount
        expect(r.voucher.receiptsRoot).toBe(receiptsRootHex(leaves))
        await commitAcceptedTip(
          {
            status: 'ACCEPTED',
            receiptId: `r${seq}`,
            receipt: p.receipt,
            leafHashes: [...leaves],
            voucher: {
              tabContractId: tabId,
              reader: reader.publicKey(),
              writer: writer.publicKey(),
              keyId: keyId as number,
              publicKey: key.info.publicKey,
              cumulative: cum.toString(),
              receiptsRoot: r.voucher.receiptsRoot,
              signature: r.submit.signature,
              acceptor: '',
              acceptanceSignature: '',
            },
            alreadyAccepted: false,
          },
          deps
        )
        last = { signature: r.submit.signature, root: r.voucher.receiptsRoot }
        if (seq === 1) {
          // settle (settler path) the first voucher.
          const { res } = await send(
            tab(settler).settle({
              settler: settler.publicKey(),
              vouchers: [
                {
                  reader: reader.publicKey(),
                  writer: writer.publicKey(),
                  key_id: keyId as number,
                  cumulative: cum,
                  receipts_root: Buffer.from(last.root, 'hex'),
                  signature: Buffer.from(last.signature, 'hex'),
                  acceptor: null,
                  acceptance_signature: null,
                },
              ],
            })
          )
          const ev = events(res).filter(
            (e) => e.contractId === tabId && e.name === 'tab_settled'
          )
          expect(ev).toHaveLength(1)
          expect((ev[0]!.data as Record<string, unknown>).cumulative).toBe(cum)
        }
      }
      // settle_own with an acceptance countersignature for the third voucher.
      const payload = voucherPayloadFor({
        tabContractId: tabId,
        networkPassphrase: LOCAL_PASSPHRASE,
        reader: reader.publicKey(),
        writer: writer.publicKey(),
        keyId: keyId as number,
        publicKey: key.publicKey(),
        cumulative: cum.toString(),
        receiptsRoot: last!.root,
      })
      const { res } = await send(
        tab(writer).settle_own({
          writer: writer.publicKey(),
          vouchers: [
            {
              reader: reader.publicKey(),
              writer: writer.publicKey(),
              key_id: keyId as number,
              cumulative: cum,
              receipts_root: Buffer.from(last!.root, 'hex'),
              signature: Buffer.from(last!.signature, 'hex'),
              acceptor: publicKeyOf(acceptorSeed),
              acceptance_signature: signEd25519(
                acceptorSeed,
                acceptancePayloadBytes(payload)
              ),
            },
          ],
        })
      )
      const ev = events(res).filter(
        (e) => e.contractId === tabId && e.name === 'tab_settled'
      )
      expect(ev).toHaveLength(1)
      expect((ev[0]!.data as Record<string, unknown>).paid_after).toBe(cum)

      // A flipped signature bit is refused by the contract.
      const bad = Buffer.from(last!.signature, 'hex')
      bad[0] = bad[0]! ^ 1
      await expect(
        send(
          tab(settler).settle({
            settler: settler.publicKey(),
            vouchers: [
              {
                reader: reader.publicKey(),
                writer: writer.publicKey(),
                key_id: keyId as number,
                cumulative: cum + BigInt(1),
                receipts_root: Buffer.from(last!.root, 'hex'),
                signature: bad,
                acceptor: null,
                acceptance_signature: null,
              },
            ],
          })
        )
      ).rejects.toThrow()
    })
  })
}
