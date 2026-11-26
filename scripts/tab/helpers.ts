/**
 * Test helpers for the browser tab modules: isolated IndexedDB factories,
 * keys with known seeds, and a small stand-in for `tabs.prepareTip` /
 * `tabs.submitTip` that follows `convex/lib/chain/tabLedger.ts` (PR #492).
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { ed25519 } from '@noble/curves/ed25519'

import shared from '../../contracts/shared/test-vectors.json'
import {
  KEYS_STORE,
  inTransaction,
  request,
  type TabDbOptions,
} from '../../lib/stellar/v2/tab/idb'
import { bytesToHex, hexToBytes } from '../../lib/stellar/v2/tab/bytes'
import {
  createLocalLedger,
  createSessionKeyStore,
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadFor,
  type PreparedTabTip,
  type SessionKeyScope,
  type SignTabTipDeps,
  type StoredReceipt,
  type SubmitTipArgs,
  type SubmittedTabTip,
} from '../../lib/stellar/v2/tab'

export const PASSPHRASE = shared.network.passphrase
export const TAB = shared.tab_contract
export const READER = shared.vouchers[0]!.reader
export const WRITER_G = shared.vouchers[0]!.writer
export const WRITER_C = shared.vouchers[1]!.writer
export const SESSION_SEED = hexToBytes(shared.keys.session.seed, 32)
export const SCOPE: SessionKeyScope = {
  tabContractId: TAB,
  readerAddress: READER,
}

let counter = 0
export function freshDb(): TabDbOptions {
  counter += 1
  return { indexedDB: new IDBFactory(), dbName: `tab-test-${counter}` }
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')

/**
 * Stores a key with a known seed, through the same record layout the store
 * writes, so vector tests can check exact signatures.
 */
export async function plantKey(
  db: TabDbOptions,
  scope: SessionKeyScope,
  seed: Uint8Array,
  backend: 'webcrypto' | 'noble',
  keyIds: number[] = []
): Promise<string> {
  const publicKey = bytesToHex(ed25519.getPublicKey(seed))
  const base = {
    tab: scope.tabContractId,
    reader: scope.readerAddress,
    publicKey,
    keyIds,
    keyRefs: keyIds.map(
      (id) => `${scope.tabContractId}|${scope.readerAddress}|${id}`
    ),
    createdAt: 1,
    unusable: null,
  }
  const record =
    backend === 'webcrypto'
      ? {
          ...base,
          backend,
          extractable: false,
          privateKey: await crypto.subtle.importKey(
            'jwk',
            {
              kty: 'OKP',
              crv: 'Ed25519',
              d: b64u(seed),
              x: b64u(ed25519.getPublicKey(seed)),
            },
            'Ed25519',
            false,
            ['sign']
          ),
        }
      : { ...base, backend, extractable: true, seed }
  await inTransaction(db, [KEYS_STORE], 'readwrite', async (tx) => {
    await request(tx.objectStore(KEYS_STORE).put(record))
  })
  return publicKey
}

export function depsFor(
  db: TabDbOptions,
  extra: Partial<SignTabTipDeps> = {}
): SignTabTipDeps {
  return {
    keys: createSessionKeyStore(db),
    ledger: createLocalLedger(db),
    networkPassphrase: PASSPHRASE,
    tabContractId: TAB,
    readerAddress: READER,
    now: () => 1_000,
    ...extra,
  }
}

type Pair = { leaves: string[]; cumulative: bigint; seq: number }

/**
 * A stand-in for the Convex tab ledger: one reader, any writers, one key per
 * call. It recomputes and verifies every voucher like `submitTabTip`.
 */
export class FakeTabServer {
  pairs = new Map<string, Pair>()
  prepared = new Map<string, PreparedTabTip>()
  accepted = new Map<string, SubmittedTabTip>()
  private next = 0

  constructor(
    readonly publicKeys: Map<number, string>,
    readonly reader = READER
  ) {}

  private pair(keyId: number, writer: string): Pair {
    const id = `${keyId}|${writer}`
    let pair = this.pairs.get(id)
    if (!pair) {
      pair = { leaves: [], cumulative: BigInt(0), seq: 0 }
      this.pairs.set(id, pair)
    }
    return pair
  }

  prepare(input: {
    keyId: number
    writer: string
    amount: bigint
    articleId?: string
    highlightId?: string | null
    clientRef?: string
    contentHash?: string
  }): PreparedTabTip {
    const pair = this.pair(input.keyId, input.writer)
    this.next += 1
    const prepareId = `prep_${this.next}`
    const receipt: StoredReceipt = {
      amount: input.amount.toString(),
      articleId: input.articleId ?? '11'.repeat(32),
      clientRef: input.clientRef ?? this.next.toString(16).padStart(32, '0'),
      contentHash: input.contentHash ?? '22'.repeat(32),
      cumulativeAfter: (pair.cumulative + input.amount).toString(),
      highlightId: input.highlightId ?? null,
      seq: pair.seq + 1,
    }
    const prepared: PreparedTabTip = {
      prepareId,
      tabContractId: TAB,
      readerAddress: this.reader,
      writer: input.writer,
      keyId: input.keyId,
      seq: pair.seq + 1,
      cumulativeBefore: pair.cumulative.toString(),
      amount: input.amount.toString(),
      receipt,
      leafHashes: [...pair.leaves],
      expiresAt: 1_000 + 300_000,
      existing: false,
    }
    this.prepared.set(prepareId, prepared)
    return structuredClone(prepared)
  }

  /** Same requestId again: the same prepared row (`existing: true`). */
  prepareAgain(prepareId: string): PreparedTabTip {
    const prepared = this.prepared.get(prepareId)!
    return { ...structuredClone(prepared), existing: true }
  }

  submit(args: SubmitTipArgs): SubmittedTabTip {
    const prepared = this.prepared.get(args.prepareId)
    if (!prepared) throw new Error('TAB_PREPARE_NOT_FOUND')
    const done = this.accepted.get(args.prepareId)
    if (done) {
      if (done.voucher.signature !== args.signature)
        throw new Error('TAB_DUPLICATE_REFERENCE')
      return { ...structuredClone(done), alreadyAccepted: true }
    }
    if (JSON.stringify(args.receipt) !== JSON.stringify(prepared.receipt))
      throw new Error('TAB_RECEIPT_MISMATCH')
    const pair = this.pair(prepared.keyId, prepared.writer)
    if (pair.seq + 1 !== prepared.seq) throw new Error('TAB_STALE_PREPARE')
    const leaves = [...pair.leaves, receiptLeafHex(args.receipt)]
    const receiptsRoot = receiptsRootHex(leaves)
    const publicKey = this.publicKeys.get(prepared.keyId)!
    const payload = voucherPayloadFor({
      tabContractId: TAB,
      networkPassphrase: PASSPHRASE,
      reader: prepared.readerAddress,
      writer: prepared.writer,
      keyId: prepared.keyId,
      publicKey: hexToBytes(publicKey, 32),
      cumulative: args.receipt.cumulativeAfter,
      receiptsRoot,
    })
    if (
      !ed25519.verify(
        hexToBytes(args.signature, 64),
        payload,
        hexToBytes(publicKey, 32)
      )
    )
      throw new Error('TAB_INVALID_SIGNATURE')
    pair.leaves = leaves
    pair.cumulative = BigInt(args.receipt.cumulativeAfter)
    pair.seq = prepared.seq
    const result: SubmittedTabTip = {
      status: 'ACCEPTED',
      receiptId: `rcpt_${args.prepareId}`,
      receipt: args.receipt,
      leafHashes: leaves,
      voucher: {
        tabContractId: TAB,
        reader: prepared.readerAddress,
        writer: prepared.writer,
        keyId: prepared.keyId,
        publicKey,
        cumulative: args.receipt.cumulativeAfter,
        receiptsRoot,
        signature: args.signature,
        acceptor: '00'.repeat(32),
        acceptanceSignature: '00'.repeat(64),
      },
      alreadyAccepted: false,
    }
    this.accepted.set(args.prepareId, result)
    return structuredClone(result)
  }
}
