/**
 * Tab session-key fixture page. It renders nothing but a status line and
 * exposes `window.tabFixture` so the Playwright suite can drive the real
 * browser modules in Chromium, Firefox and WebKit. No backend: the shared
 * test vectors stand in for Convex.
 */
import { ed25519 } from '@noble/curves/ed25519'

import shared from '../../../contracts/shared/test-vectors.json'
import { bytesToHex, hexToBytes } from '../../../lib/stellar/v2/tab/bytes'
import {
  KEYS_STORE,
  TAB_DB_NAME,
  closeTabDb,
  inTransaction,
  request,
} from '../../../lib/stellar/v2/tab/idb'
import {
  commitAcceptedTip,
  createLocalLedger,
  createSessionKeyStore,
  receiptLeafHex,
  signTabTip,
  supportsWebCryptoEd25519,
  voucherPayloadFor,
  type PreparedTabTip,
  type SessionKeyScope,
  type SignTabTipDeps,
  type StoredReceipt,
} from '../../../lib/stellar/v2/tab'

const voucher = shared.vouchers[0]!
const SCOPE: SessionKeyScope = {
  tabContractId: shared.tab_contract,
  readerAddress: voucher.reader,
}
const PASSPHRASE = shared.network.passphrase
const SEED = hexToBytes(shared.keys.session.seed, 32)
const VECTOR_KEY_ID = voucher.key_id
const GENERATED_KEY_ID = 7

const violations: string[] = []
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push(`${event.violatedDirective} ${event.blockedURI}`)
})

const items: StoredReceipt[] = shared.receipts.items.map((r) => ({
  amount: r.amount,
  articleId: r.article_id,
  clientRef: r.client_ref,
  contentHash: r.content_hash,
  cumulativeAfter: r.cumulative_after,
  highlightId: r.highlight_id,
  seq: r.seq,
}))

function deps(forceFallback = false): SignTabTipDeps {
  return {
    keys: createSessionKeyStore({ forceFallback }),
    ledger: createLocalLedger(),
    networkPassphrase: PASSPHRASE,
    tabContractId: SCOPE.tabContractId,
    readerAddress: SCOPE.readerAddress,
    now: () => 1_000,
  }
}

function vectorPayload(publicKey: Uint8Array): Uint8Array {
  return voucherPayloadFor({
    tabContractId: shared.tab_contract,
    networkPassphrase: PASSPHRASE,
    reader: voucher.reader,
    writer: voucher.writer,
    keyId: voucher.key_id,
    publicKey,
    cumulative: voucher.cumulative,
    receiptsRoot: voucher.receipts_root,
  })
}

const b64u = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/**
 * Stores the vector seed as a key in this browser, in the store's own
 * record layout: a non-extractable WebCrypto key where supported, else the
 * fallback seed.
 */
async function plantVectorKey(
  forceFallback = false
): Promise<{ backend: string }> {
  const publicKey = ed25519.getPublicKey(SEED)
  const base = {
    tab: SCOPE.tabContractId,
    reader: SCOPE.readerAddress,
    publicKey: bytesToHex(publicKey),
    keyIds: [VECTOR_KEY_ID],
    keyRefs: [`${SCOPE.tabContractId}|${SCOPE.readerAddress}|${VECTOR_KEY_ID}`],
    createdAt: 1,
    unusable: null,
  }
  const record =
    !forceFallback && (await supportsWebCryptoEd25519())
      ? {
          ...base,
          backend: 'webcrypto',
          extractable: false,
          privateKey: await crypto.subtle.importKey(
            'jwk',
            { kty: 'OKP', crv: 'Ed25519', d: b64u(SEED), x: b64u(publicKey) },
            'Ed25519',
            false,
            ['sign']
          ),
        }
      : { ...base, backend: 'noble', extractable: true, seed: SEED }
  await inTransaction({}, [KEYS_STORE], 'readwrite', async (tx) => {
    await request(tx.objectStore(KEYS_STORE).put(record))
  })
  return { backend: record.backend }
}

async function signWith(keyId: number, forceFallback = false) {
  const key = await deps(forceFallback).keys.get(SCOPE, keyId)
  if (!key) return { found: false as const }
  const payload = vectorPayload(key.publicKey())
  const signature = await key.sign(payload)
  const again = await key.sign(payload)
  return {
    found: true as const,
    /** False on engines that sign ed25519 with a random nonce. */
    deterministic: bytesToHex(again) === bytesToHex(signature),
    backend: key.info.backend,
    extractable: key.info.extractable,
    publicKey: key.info.publicKey,
    signature: bytesToHex(signature),
    verifies: ed25519.verify(signature, payload, key.publicKey()),
  }
}

const api = {
  async support() {
    return {
      webCryptoEd25519: await supportsWebCryptoEd25519(),
      violations: [...violations],
    }
  },

  /** Deletes the database, as cleared site data or storage eviction does. */
  async evict() {
    await closeTabDb()
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(TAB_DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.onblocked = () => resolve()
    })
  },

  plantVectorKey,

  /** Signs the G/G vector payload with the stored vector key. */
  async signVector() {
    const result = await signWith(VECTOR_KEY_ID)
    return {
      ...result,
      expectedSignature: voucher.signature,
      payloadMatches:
        bytesToHex(
          vectorPayload(hexToBytes(shared.keys.session.public_key, 32))
        ) === voucher.payload_xdr,
    }
  },

  /** Generates a key and binds it to `GENERATED_KEY_ID`. */
  async generate(forceFallback: boolean) {
    const d = deps(forceFallback)
    const key = await d.keys.generate(SCOPE)
    await d.keys.bindKeyIds(SCOPE, [
      { keyId: GENERATED_KEY_ID, publicKey: key.info.publicKey },
    ])
    return {
      backend: key.info.backend,
      extractable: key.info.extractable,
      publicKey: key.info.publicKey,
    }
  },

  signGenerated: () => signWith(GENERATED_KEY_ID),

  async status(keyId: number, publicKey: string) {
    return deps().keys.status(
      SCOPE,
      { keyId, publicKey, validUntilLedger: 1_000_000, revoked: false },
      1_000
    )
  },

  /**
   * Runs `signTabTip` and `commitAcceptedTip` over the three shared
   * receipts with the vector key, as Convex would prepare and accept them.
   */
  async tipSequence() {
    const d = deps()
    const leaves: string[] = []
    const out: { kind: string; signature?: string; root?: string }[] = []
    for (const receipt of items) {
      const prepared: PreparedTabTip = {
        prepareId: `prep_${receipt.seq}`,
        tabContractId: SCOPE.tabContractId,
        readerAddress: SCOPE.readerAddress,
        writer: voucher.writer,
        keyId: VECTOR_KEY_ID,
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
      const result = await signTabTip(prepared, d)
      if (result.kind !== 'signed') {
        out.push({ kind: result.kind })
        break
      }
      leaves.push(receiptLeafHex(receipt))
      await commitAcceptedTip(
        {
          status: 'ACCEPTED',
          receiptId: `r${receipt.seq}`,
          receipt,
          leafHashes: [...leaves],
          voucher: {
            tabContractId: SCOPE.tabContractId,
            reader: SCOPE.readerAddress,
            writer: voucher.writer,
            keyId: VECTOR_KEY_ID,
            publicKey: shared.keys.session.public_key,
            cumulative: result.voucher.cumulative,
            receiptsRoot: result.voucher.receiptsRoot,
            signature: result.submit.signature,
            acceptor: shared.keys.acceptor.public_key,
            acceptanceSignature: '00'.repeat(64),
          },
          alreadyAccepted: false,
        },
        d
      )
      out.push({
        kind: result.kind,
        signature: result.submit.signature,
        root: result.voucher.receiptsRoot,
      })
    }
    return {
      steps: out,
      expectedRoot: voucher.receipts_root,
      expectedSignature: voucher.signature,
    }
  },

  /** `signTabTip` for a key this browser does not hold. */
  async tipWithKey(keyId: number) {
    const receipt = items[0]!
    const result = await signTabTip(
      {
        prepareId: 'prep_missing',
        tabContractId: SCOPE.tabContractId,
        readerAddress: SCOPE.readerAddress,
        writer: voucher.writer,
        keyId,
        seq: 1,
        cumulativeBefore: '0',
        amount: receipt.amount,
        receipt,
        leafHashes: [],
        expiresAt: 10_000,
        existing: false,
      },
      deps()
    )
    return result.kind === 'stop'
      ? { kind: result.kind, reason: result.reason, message: result.message }
      : { kind: result.kind }
  },

  /** Records the first receipt as pending for the vector pair. */
  async recordFirstPending() {
    return deps().ledger.recordPending(
      SCOPE,
      VECTOR_KEY_ID,
      voucher.writer,
      { cumulativeBefore: '0', leafHashes: [] },
      {
        seq: 1,
        cumulativeAfter: items[0]!.cumulativeAfter,
        leafHash: receiptLeafHex(items[0]!),
        prepareId: 'prep_1',
        signature: '00'.repeat(64),
        createdAt: 1,
      }
    )
  },

  /** Commits the first receipt; run from two tabs at once. */
  async commitFirst() {
    const result = await deps().ledger.commitAccepted(SCOPE, {
      keyId: VECTOR_KEY_ID,
      writer: voucher.writer,
      cumulative: items[0]!.cumulativeAfter,
      leafHashes: [receiptLeafHex(items[0]!)],
    })
    return result.status
  },

  async ledger() {
    return deps().ledger.read(SCOPE, VECTOR_KEY_ID, voucher.writer)
  },
}

declare global {
  interface Window {
    tabFixture: typeof api
  }
}

window.tabFixture = api
document.getElementById('status')!.textContent = 'ready'
