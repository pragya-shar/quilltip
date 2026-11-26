/**
 * End-to-end flows of docs/architecture/v2/05-flows-and-admin.md on a local
 * Stellar network, through the generated bindings.
 *
 * Run with `bun run test:local-network` (scripts/integration/run.ts). The
 * runner starts Quickstart, builds the contracts and passes:
 * - QUILLTIP_WASM_DIR: quilltip_core.wasm, quilltip_tab.wasm, quilltip_article_nft.wasm
 * - QUILLTIP_CORE_UPGRADE_WASM: Core built with `--features upgrade-test`
 * - QUILLTIP_INTEGRATION_OUT: where measurements and event fixtures are written
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { Keypair, rpc } from '@stellar/stellar-sdk'
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Client as CoreClient } from '../../lib/stellar/v2/bindings/core'
import { articleId, articleRef } from '../../lib/stellar/v2/ids'
import { Client as NftClient } from '../../lib/stellar/v2/bindings/nft'
import {
  Client as TabClient,
  type Voucher,
} from '../../lib/stellar/v2/bindings/tab'
import {
  acceptancePayloadBytes,
  merkleRoot,
  publicKeyOf,
  receiptLeaf,
  sha256,
  signEd25519,
  voucherPayloadBytes,
  type TipReceiptFields,
} from '../../lib/stellar/v2/tab/encoding'
import {
  Harness,
  LOCAL_PASSPHRASE,
  XLM,
  events,
  metrics,
  systemEventCount,
  type TxMetrics,
} from './harness'
import { bytesToHex, hexToBytes } from '../../convex/lib/chain/ids'
import { decodeRpcEvent } from '../../convex/lib/chain/events'
import { toStoredValue } from '../../convex/lib/chain/indexerStore'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import {
  matchNftEvent,
  nftEventFacts,
  verifyNftTransaction,
  type ExpectedNft,
} from '../../convex/lib/chain/nftEvents'
import type { PreparedNftMint, PreparedNftTransfer } from '../../convex/nftsV2'

const FEE_BPS = BigInt(250)
const DENOM = BigInt(10_000)
const fee = (gross: bigint) => (gross * FEE_BPS) / DENOM
const WITHDRAW_DELAY = 3 * 17_280
const NETWORK_ID = sha256(new TextEncoder().encode(LOCAL_PASSPHRASE))

const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const upgradeWasm = process.env.QUILLTIP_CORE_UPGRADE_WASM ?? ''
const outDir = process.env.QUILLTIP_INTEGRATION_OUT ?? ''

type Sent = rpc.Api.GetSuccessfulTransactionResponse
const measured: TxMetrics[] = []
const fixtures: Record<string, ReturnType<typeof events>> = {}
const reduction: Record<string, unknown> = {}

async function send<T>(
  label: string,
  txp: Promise<AssembledTransaction<T>>
): Promise<{ res: Sent; result: T }> {
  const tx = await txp
  const sent = await tx.signAndSend()
  const res = sent.getTransactionResponse
  if (!res || res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${label}: transaction did not succeed (${res?.status})`)
  }
  measured.push(metrics(label, res))
  fixtures[label] = events(res)
  return { res, result: sent.result }
}

/** Expects the call to fail with `Error(Contract, #code)`, in simulation or on submission. */
async function expectContractError(
  txp: Promise<AssembledTransaction<unknown>>,
  code: number
) {
  let message = ''
  try {
    const tx = await txp
    await tx.signAndSend()
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  expect(message).toContain(`Error(Contract, #${code})`)
}

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))

function named(res: Sent, contract: string, name: string) {
  return events(res).filter((e) => e.contractId === contract && e.name === name)
}

const h = new Harness()
let admin: Keypair,
  pauser: Keypair,
  upgrader: Keypair,
  settler: Keypair,
  treasury: Keypair
let author: Keypair,
  author2: Keypair,
  coauthor: Keypair,
  tipper: Keypair,
  collector: Keypair
let token: string, coreId: string, tabId: string, nftId: string
const acceptorSeed = rand(32)
const core = (kp: Keypair) => new CoreClient(h.opts(coreId, kp))
const tab = (kp: Keypair) => new TabClient(h.opts(tabId, kp))
const nft = (kp: Keypair) => new NftClient(h.opts(nftId, kp))
const R1 = articleRef('integration-article-1')
const R2 = articleRef('integration-article-2')
const R3 = articleRef('integration-article-split')
// Article IDs bind each reference to its author; set once the accounts exist.
let A1: Uint8Array, A2: Uint8Array, A3: Uint8Array

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[
    admin,
    pauser,
    upgrader,
    settler,
    treasury,
    author,
    author2,
    coauthor,
    tipper,
    collector,
  ] = (await h.accounts(10)) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ]
  A1 = articleId(author.publicKey(), R1)
  A2 = articleId(author2.publicKey(), R2)
  A3 = articleId(author.publicKey(), R3)
  token = h.ensureNativeSac(admin)
  const coreHash = h.uploadWasm(join(wasmDir, 'quilltip_core.wasm'), admin)
  const tabHash = h.uploadWasm(join(wasmDir, 'quilltip_tab.wasm'), admin)
  const nftHash = h.uploadWasm(
    join(wasmDir, 'quilltip_article_nft.wasm'),
    admin
  )
  const roles = {
    admin: admin.publicKey(),
    pauser: pauser.publicKey(),
    upgrader: upgrader.publicKey(),
  }
  coreId = h.deploy(coreHash, admin, {
    ...roles,
    treasury: treasury.publicKey(),
    token,
    min_tip: '1000000',
  })
  tabId = h.deploy(tabHash, admin, {
    ...roles,
    settler: settler.publicKey(),
    token,
    treasury: treasury.publicKey(),
    max_balance: (BigInt(1_000) * XLM).toString(),
    min_deposit: XLM.toString(),
    acceptor_key: Buffer.from(publicKeyOf(acceptorSeed)).toString('hex'),
  })
  nftId = h.deploy(nftHash, admin, {
    ...roles,
    core: coreId,
    threshold_token: token,
    threshold: (BigInt(50) * XLM).toString(),
    base_uri: 'https://www.quilltip.me/api/nft/',
  })
}, 600_000)

afterAll(() => {
  if (!outDir) return
  mkdirSync(outDir, { recursive: true })
  const json = (v: unknown) =>
    JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2)
  writeFileSync(
    join(outDir, 'measurements.json'),
    json({ measured, reduction })
  )
  writeFileSync(join(outDir, 'events.json'), json(fixtures))
  // One recorded event per event name, for the Convex tests.
  const roles: Record<string, string> = {
    [coreId]: 'core',
    [tabId]: 'tab',
    [nftId]: 'nft',
    [token]: 'token',
  }
  const seen = new Set<string>()
  const curated = []
  for (const [label, list] of Object.entries(fixtures)) {
    for (const e of list) {
      const key = `${roles[e.contractId ?? ''] ?? 'other'}:${e.name}`
      if (seen.has(key)) continue
      seen.add(key)
      curated.push({
        transaction: label,
        contract: roles[e.contractId ?? ''] ?? 'other',
        name: e.name,
        xdr: e.xdr,
      })
    }
  }
  writeFileSync(
    join(outDir, 'event-fixtures.json'),
    json({
      contracts: { core: coreId, tab: tabId, nft: nftId, token },
      events: curated,
    }) + '\n'
  )
})

describe('5.1 article registration', () => {
  it('registers articles with content anchors and splits', async () => {
    const content = rand(32)
    const { res, result } = await send(
      'register_article',
      core(author).register_article({
        author: author.publicKey(),
        article_ref: R1,
        content_hash: content,
        arweave_id: null,
        splits: [],
      })
    )
    // Core returns the author-bound ID, and the view and event agree with it.
    expect(Buffer.from(result).equals(Buffer.from(A1))).toBe(true)
    const viewId = (
      await core(author).article_id({
        author: author.publicKey(),
        article_ref: R1,
      })
    ).result
    expect(Buffer.from(viewId).equals(Buffer.from(A1))).toBe(true)
    const registered = named(res, coreId, 'article_registered')
    expect(registered).toHaveLength(1)
    const regData = registered[0]!.data as Record<string, unknown>
    expect(
      Buffer.from(regData.article_ref as Uint8Array).equals(Buffer.from(R1))
    ).toBe(true)
    expect(
      Buffer.from(registered[0]!.topics[1] as Uint8Array).equals(
        Buffer.from(A1)
      )
    ).toBe(true)
    const rec = (await core(author).get_article({ article_id: A1 })).result
    expect(rec?.author).toBe(author.publicKey())
    expect(Buffer.from(rec!.content_hash).equals(Buffer.from(content))).toBe(
      true
    )
    await send(
      'register_article_2',
      core(author2).register_article({
        author: author2.publicKey(),
        article_ref: R2,
        content_hash: rand(32),
        arweave_id: rand(32),
        splits: [],
      })
    )
    await send(
      'register_article_split',
      core(author).register_article({
        author: author.publicKey(),
        article_ref: R3,
        content_hash: rand(32),
        arweave_id: null,
        splits: [
          { recipient: author.publicKey(), bps: 7_000 },
          { recipient: coauthor.publicKey(), bps: 3_000 },
        ],
      })
    )
    await expectContractError(
      core(author).register_article({
        author: author.publicKey(),
        article_ref: R1,
        content_hash: rand(32),
        arweave_id: null,
        splits: [],
      }),
      2
    )
    // Another account that registers the same reference gets its own ID and
    // leaves the author's article unchanged.
    const other = await send(
      'register_same_ref_other_author',
      core(author2).register_article({
        author: author2.publicKey(),
        article_ref: R1,
        content_hash: rand(32),
        arweave_id: null,
        splits: [],
      })
    )
    expect(Buffer.from(other.result).equals(Buffer.from(A1))).toBe(false)
    expect(
      Buffer.from(other.result).equals(
        Buffer.from(articleId(author2.publicKey(), R1))
      )
    ).toBe(true)
    expect(
      (await core(tipper).get_article({ article_id: A1 })).result?.author
    ).toBe(author.publicKey())
  })
})

describe('5.2 to 5.4 direct, highlight and batch tips', () => {
  it('direct tip splits 97.5% / 2.5% to the stroop', async () => {
    const gross = BigInt(10) * XLM + BigInt(39)
    const [a0, t0] = [
      await h.balance(author.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const ref = rand(16)
    const { res } = await send(
      'tip',
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A1,
        token,
        amount: gross,
        highlight_id: null,
        client_ref: ref,
      })
    )
    expect(await h.balance(author.publicKey())).toBe(a0 + gross - fee(gross))
    expect(await h.balance(treasury.publicKey())).toBe(t0 + fee(gross))
    const tipped = named(res, coreId, 'tipped')
    expect(tipped).toHaveLength(1)
    const data = tipped[0]!.data as Record<string, unknown>
    expect(data.gross).toBe(gross)
    expect(data.fee).toBe(fee(gross))
    expect(data.net).toBe(gross - fee(gross))
    expect(
      Buffer.from(data.client_ref as Uint8Array).equals(Buffer.from(ref))
    ).toBe(true)
    expect(
      (await core(tipper).article_total({ article_id: A1, token })).result
    ).toBe(gross)
    // Same client_ref again from the same tipper: DuplicateClientRef (10).
    await expectContractError(
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A1,
        token,
        amount: gross,
        highlight_id: null,
        client_ref: ref,
      }),
      10
    )
    // Below the minimum tip (8) and self-tip (9).
    await expectContractError(
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A1,
        token,
        amount: BigInt(999_999),
        highlight_id: null,
        client_ref: rand(16),
      }),
      8
    )
    await expectContractError(
      core(author).tip({
        tipper: author.publicKey(),
        article_id: A1,
        token,
        amount: XLM,
        highlight_id: null,
        client_ref: rand(16),
      }),
      9
    )
  })

  it('highlight tip carries the highlight ID in the event', async () => {
    const highlight = rand(32)
    const gross = BigInt(3) * XLM
    const [a0, t0] = [
      await h.balance(author2.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const { res } = await send(
      'tip_highlight',
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A2,
        token,
        amount: gross,
        highlight_id: highlight,
        client_ref: rand(16),
      })
    )
    expect(await h.balance(author2.publicKey())).toBe(a0 + gross - fee(gross))
    expect(await h.balance(treasury.publicKey())).toBe(t0 + fee(gross))
    const data = named(res, coreId, 'tipped')[0]!.data as Record<
      string,
      unknown
    >
    expect(
      Buffer.from(data.highlight_id as Uint8Array).equals(
        Buffer.from(highlight)
      )
    ).toBe(true)
  })

  it('co-author split pays shares to the stroop', async () => {
    const gross = BigInt(7) * XLM + BigInt(3)
    const [a0, c0, t0] = await Promise.all(
      [author, coauthor, treasury].map((k) => h.balance(k.publicKey()))
    )
    await send(
      'tip_split',
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A3,
        token,
        amount: gross,
        highlight_id: null,
        client_ref: rand(16),
      })
    )
    const net = gross - fee(gross)
    const co = (net * BigInt(3_000)) / DENOM
    expect(await h.balance(coauthor.publicKey())).toBe(c0! + co)
    expect(await h.balance(author.publicKey())).toBe(a0! + net - co)
    expect(await h.balance(treasury.publicKey())).toBe(t0! + fee(gross))
  })

  it('batch of 10 tips in one transaction', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      article_id: i % 2 === 0 ? A1 : A2,
      amount: XLM + BigInt(i),
      highlight_id: i % 3 === 0 ? rand(32) : null,
      client_ref: rand(16),
    }))
    const [t0, a0, b0] = [
      await h.balance(treasury.publicKey()),
      await h.balance(author.publicKey()),
      await h.balance(author2.publicKey()),
    ]
    const { res } = await send(
      'tip_batch_10',
      core(tipper).tip_batch({ tipper: tipper.publicKey(), token, items })
    )
    expect(named(res, coreId, 'tipped')).toHaveLength(10)
    const fees = items.reduce((s, it) => s + fee(it.amount), BigInt(0))
    expect(await h.balance(treasury.publicKey())).toBe(t0 + fees)
    const netTo = (id: Uint8Array) =>
      items
        .filter((it) => it.article_id === id)
        .reduce((s, it) => s + it.amount - fee(it.amount), BigInt(0))
    expect(await h.balance(author.publicKey())).toBe(a0 + netTo(A1))
    expect(await h.balance(author2.publicKey())).toBe(b0 + netTo(A2))
  })
})

/** Opens a tab for a fresh reader and returns its session seed and key ID. */
async function openTab(reader: Keypair, deposit: bigint, spendLimit: bigint) {
  const seed = rand(32)
  const until = (await h.latestLedger()) + 20_000
  const { res, result } = await busyRetry(() =>
    send(
      'open_session',
      tab(reader).open_session({
        reader: reader.publicKey(),
        amount: deposit,
        public_key: publicKeyOf(seed),
        valid_until: until,
        spend_limit: spendLimit,
      })
    )
  )
  const keyId = result as number
  // Deposited and KeyRegistered carry the exact amounts and key (fresh reader).
  const deposited = named(res, tabId, 'deposited')
  expect(deposited).toHaveLength(1)
  const dep = deposited[0]!.data as Record<string, unknown>
  expect([dep.amount, dep.balance_after]).toEqual([deposit, deposit])
  const registered = named(res, tabId, 'key_registered')
  expect(registered).toHaveLength(1)
  const key = registered[0]!.data as Record<string, unknown>
  expect([key.key_id, key.valid_until, key.spend_limit]).toEqual([
    keyId,
    until,
    spendLimit,
  ])
  expect(
    Buffer.from(key.public_key as Uint8Array).equals(
      Buffer.from(publicKeyOf(seed))
    )
  ).toBe(true)
  return { seed, keyId, res }
}

/**
 * Retries a call that the RPC refused because its simulation queue was full.
 * The contract never saw the refused call, so a retry is safe.
 */
async function busyRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!/queue full|retry later/i.test(message) || attempt >= 10) throw e
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)))
    }
  }
}

/** Opens a 5 XLM tab for each reader, four at a time to keep RPC load low. */
async function openTabs(readers: Keypair[]) {
  const out: Awaited<ReturnType<typeof openTab>>[] = []
  for (let i = 0; i < readers.length; i += 4) {
    out.push(
      ...(await Promise.all(
        readers
          .slice(i, i + 4)
          .map((r) => openTab(r, BigInt(5) * XLM, BigInt(5) * XLM))
      ))
    )
  }
  return out
}

function voucher(
  reader: string,
  writer: string,
  keyId: number,
  seed: Uint8Array,
  cumulative: bigint,
  root: Uint8Array,
  accept = false
): Voucher {
  const payload = voucherPayloadBytes({
    tab: tabId,
    networkId: NETWORK_ID,
    reader,
    writer,
    keyId,
    publicKey: publicKeyOf(seed),
    cumulative,
    receiptsRoot: root,
  })
  const signature = signEd25519(seed, payload)
  return {
    reader,
    writer,
    key_id: keyId,
    cumulative,
    receipts_root: root,
    signature,
    acceptor: accept ? publicKeyOf(acceptorSeed) : null,
    acceptance_signature: accept
      ? signEd25519(acceptorSeed, acceptancePayloadBytes(payload))
      : null,
  }
}

describe('5.5 to 5.9 tab', () => {
  it('open, vouchers in TypeScript, settle, settle_own, claim', async () => {
    const reader = await h.account()
    const writer = await h.account()
    const [r0, tab0] = [
      await h.balance(reader.publicKey()),
      await h.balance(tabId),
    ]
    const opened = await openTab(reader, BigInt(20) * XLM, BigInt(20) * XLM)
    const { seed, keyId } = opened
    // The deposit moves exactly 20 XLM; the reader also pays the network fee.
    expect(await h.balance(tabId)).toBe(tab0 + BigInt(20) * XLM)
    expect(await h.balance(reader.publicKey())).toBe(
      r0 - BigInt(20) * XLM - opened.res.resultXdr.feeCharged
    )
    // The contract's own payload bytes equal the TypeScript encoder's (I-23).
    const root = rand(32)
    const view = (
      await tab(reader).voucher_payload({
        reader: reader.publicKey(),
        writer: writer.publicKey(),
        key_id: keyId,
        cumulative: XLM,
        receipts_root: root,
      })
    ).result
    expect(Buffer.from(view).toString('hex')).toBe(
      Buffer.from(
        voucherPayloadBytes({
          tab: tabId,
          networkId: NETWORK_ID,
          reader: reader.publicKey(),
          writer: writer.publicKey(),
          keyId,
          publicKey: publicKeyOf(seed),
          cumulative: XLM,
          receiptsRoot: root,
        })
      ).toString('hex')
    )
    // Receipts and their Merkle root, as Convex would anchor them.
    const receipts: TipReceiptFields[] = [1, 2, 3].map((seq) => ({
      amount: XLM,
      articleId: A1,
      clientRef: rand(16),
      contentHash: rand(32),
      cumulativeAfter: XLM * BigInt(seq),
      highlightId: seq === 2 ? rand(32) : null,
      seq,
    }))
    const r3 = merkleRoot(receipts.map(receiptLeaf))
    const settled = await send(
      'settle_1',
      tab(settler).settle({
        settler: settler.publicKey(),
        vouchers: [
          voucher(
            reader.publicKey(),
            writer.publicKey(),
            keyId,
            seed,
            BigInt(3) * XLM,
            r3
          ),
        ],
      })
    )
    const ev = named(settled.res, tabId, 'tab_settled')[0]!.data as Record<
      string,
      unknown
    >
    expect(ev.gross).toBe(BigInt(3) * XLM)
    expect(ev.fee).toBe(fee(BigInt(3) * XLM))
    expect([ev.key_id, ev.cumulative, ev.paid_after, ev.by_writer]).toEqual([
      keyId,
      BigInt(3) * XLM,
      BigInt(3) * XLM,
      false,
    ])
    expect(
      Buffer.from(ev.receipts_root as Uint8Array).equals(Buffer.from(r3))
    ).toBe(true)
    // settle_own with an acceptance countersignature, by the writer.
    const own = await send(
      'settle_own_1',
      tab(writer).settle_own({
        writer: writer.publicKey(),
        vouchers: [
          voucher(
            reader.publicKey(),
            writer.publicKey(),
            keyId,
            seed,
            BigInt(5) * XLM + BigInt(39),
            rand(32),
            true
          ),
        ],
      })
    )
    const ownEvents = named(own.res, tabId, 'tab_settled')
    expect(ownEvents).toHaveLength(1)
    const ownEv = ownEvents[0]!.data as Record<string, unknown>
    // Cumulative fee rule (I-31): treasury holds fee(paid), writer holds paid - fee(paid).
    const paid = BigInt(5) * XLM + BigInt(39)
    expect([ownEv.gross, ownEv.fee, ownEv.paid_after, ownEv.by_writer]).toEqual(
      [paid - BigInt(3) * XLM, fee(paid) - fee(BigInt(3) * XLM), paid, true]
    )
    expect(
      (await tab(reader).account({ reader: reader.publicKey() })).result
        ?.balance
    ).toBe(BigInt(20) * XLM - paid)
    expect(
      (await tab(writer).claimable({ owner: writer.publicKey() })).result
    ).toBe(paid - fee(paid))
    // Claim submitted by someone else: the writer's balance rises by exactly the net.
    const w0 = await h.balance(writer.publicKey())
    await send('claim', tab(settler).claim({ recipient: writer.publicKey() }))
    expect(await h.balance(writer.publicKey())).toBe(w0 + paid - fee(paid))
    // Conservation: the Tab holds exactly the reader balance plus the treasury claimable.
    const acct = (await tab(reader).account({ reader: reader.publicKey() }))
      .result
    const tc = (await tab(reader).claimable({ owner: treasury.publicKey() }))
      .result
    expect(await h.balance(tabId)).toBe(acct!.balance + tc)
  })

  it('withdrawal waits WITHDRAW_DELAY ledgers', async () => {
    const reader = await h.account()
    await openTab(reader, BigInt(2) * XLM, XLM)
    const { res } = await send(
      'withdraw_start',
      tab(reader).withdraw_start({ reader: reader.publicKey() })
    )
    const started = named(res, tabId, 'withdraw_started')[0]!.data as Record<
      string,
      unknown
    >
    expect(started.unlock_ledger).toBe(res.ledger + WITHDRAW_DELAY)
    // Before the unlock ledger: WithdrawLocked (41). Waiting 51,840 ledgers is
    // out of reach for a CI run; the unit tests cover the unlock ledger itself.
    await expectContractError(
      tab(reader).withdraw({ reader: reader.publicKey() }),
      41
    )
    // A deposit cancels the pending withdrawal.
    const dep = await send(
      'deposit_cancels',
      tab(reader).deposit({ reader: reader.publicKey(), amount: XLM })
    )
    expect(named(dep.res, tabId, 'withdraw_cancelled')).toHaveLength(1)
  })
})

/**
 * The server side of #450 on real transactions: the call is built from the
 * values `nftsV2.prepareMint` / `prepareTransfer` return, rule (a) runs
 * `verifyNftTransaction` on the `getTransaction` response through the Convex
 * RPC client, and the indexer path decodes the `getEvents` page into the
 * facts the NFT handlers apply. The Convex mutations themselves do not run
 * here: the backend network guard accepts TESTNET only, so Convex functions
 * cannot target a LOCAL network (scripts/chain/nft-v2.test.ts covers them).
 */
const backendRpc = () =>
  createRpcClient({ url: h.net.rpcUrl, fetch: fetch as unknown as RpcFetch })

async function serverVerifies(
  hash: string,
  expected: ExpectedNft,
  createdLedger: number
) {
  const tx = await backendRpc().getTransaction(hash)
  expect(tx.status).toBe('SUCCESS')
  return verifyNftTransaction({
    expected,
    nftContractId: nftId,
    contractEventsXdr: tx.contractEventsXdr,
    ledger: tx.ledger!,
    createdLedger,
  })
}

/** The NFT facts of the transaction, as the indexer stores and parses them. */
async function indexedFacts(hash: string, ledger: number) {
  const page = await backendRpc().getEvents({
    startLedger: ledger,
    filters: [{ type: 'contract', contractIds: [nftId] }],
    pagination: { limit: 100 },
  })
  return page.events
    .filter((e) => e.txHash === hash)
    .map((e) => {
      const d = decodeRpcEvent(e)
      return nftEventFacts({
        name: d.name,
        topics: toStoredValue(d.topics) as unknown[],
        data: toStoredValue(d.data),
      })
    })
    .filter((f) => f !== null)
}

describe('5.10 NFT', () => {
  it('mints at the Core threshold and transfers on chain', async () => {
    await expectContractError(nft(author2).mint({ article_id: A2 }), 70)
    await send(
      'tip_to_threshold',
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A2,
        token,
        amount: BigInt(50) * XLM,
        highlight_id: null,
        client_ref: rand(16),
      })
    )
    // The values prepareMint returns for this article.
    const startLedger = (await h.server.getLatestLedger()).sequence
    const preparedMint: Pick<
      PreparedNftMint,
      'contractId' | 'signer' | 'method' | 'args' | 'articleKey'
    > = {
      contractId: nftId,
      signer: author2.publicKey(),
      method: 'mint',
      args: { article_id: bytesToHex(A2) },
      articleKey: bytesToHex(A2),
    }
    const { res, result } = await send(
      'nft_mint',
      nft(author2).mint({
        article_id: hexToBytes(preparedMint.args.article_id),
      })
    )
    expect(named(res, nftId, 'article_nft_minted')).toHaveLength(1)
    const tokenId = result as number
    const mintExpected: ExpectedNft = {
      action: 'mint',
      articleKey: preparedMint.articleKey,
      signer: preparedMint.signer,
    }
    const totalAtMint = (
      await core(author2).article_total({ article_id: A2, token })
    ).result
    expect(
      await serverVerifies(res.txHash, mintExpected, startLedger)
    ).toMatchObject({
      status: 'CONFIRMED',
      facts: {
        name: 'article_nft_minted',
        articleKey: bytesToHex(A2),
        author: author2.publicKey(),
        tokenId,
        totalAtMint: String(totalAtMint),
      },
    })
    // A mint verified against another author is a MISMATCH, never CONFIRMED.
    expect(
      await serverVerifies(
        res.txHash,
        { ...mintExpected, signer: collector.publicKey() },
        startLedger
      )
    ).toMatchObject({ status: 'MISMATCH', mismatchReason: 'author' })
    const mintFacts = await indexedFacts(res.txHash, res.ledger)
    expect(mintFacts.map((f) => f!.name)).toEqual(['article_nft_minted'])
    expect(matchNftEvent(mintExpected, mintFacts[0]!).status).toBe('CONFIRMED')
    expect((await nft(author2).owner_of({ token_id: tokenId })).result).toBe(
      author2.publicKey()
    )
    const [receiver, royalty] = (
      await nft(author2).royalty_info({
        token_id: tokenId,
        sale_price: BigInt(1_000),
      })
    ).result
    expect([receiver, royalty]).toEqual([author2.publicKey(), BigInt(100)])
    // The values prepareTransfer returns for a recipient address.
    const preparedTransfer: Pick<
      PreparedNftTransfer,
      'contractId' | 'signer' | 'method' | 'args'
    > = {
      contractId: nftId,
      signer: author2.publicKey(),
      method: 'transfer',
      args: {
        from: author2.publicKey(),
        to: collector.publicKey(),
        token_id: tokenId,
      },
    }
    const moved = await send(
      'nft_transfer',
      nft(author2).transfer(preparedTransfer.args)
    )
    expect((await nft(collector).owner_of({ token_id: tokenId })).result).toBe(
      collector.publicKey()
    )
    const transferExpected: ExpectedNft = {
      action: 'transfer',
      tokenId,
      from: preparedTransfer.args.from,
      to: preparedTransfer.args.to,
    }
    expect(
      await serverVerifies(moved.res.txHash, transferExpected, startLedger)
    ).toMatchObject({
      status: 'CONFIRMED',
      facts: {
        name: 'transfer',
        from: author2.publicKey(),
        to: collector.publicKey(),
        tokenId,
      },
    })
    expect(
      await serverVerifies(
        moved.res.txHash,
        { ...transferExpected, to: tipper.publicKey() },
        startLedger
      )
    ).toMatchObject({ status: 'MISMATCH', mismatchReason: 'field:to' })
    const transferFacts = await indexedFacts(moved.res.txHash, moved.res.ledger)
    expect(transferFacts).toEqual([
      {
        name: 'transfer',
        from: author2.publicKey(),
        to: collector.publicKey(),
        tokenId,
      },
    ])
    await expectContractError(nft(author2).mint({ article_id: A2 }), 71)
  })
})

describe('pause scope', () => {
  it('pausing Core stops tips; pausing the Tab stops deposits but not settlement', async () => {
    await send('core_pause', core(pauser).pause({ caller: pauser.publicKey() }))
    await expectContractError(
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A1,
        token,
        amount: XLM,
        highlight_id: null,
        client_ref: rand(16),
      }),
      1000
    )
    await send(
      'core_unpause',
      core(admin).unpause({ caller: admin.publicKey() })
    )

    const reader = await h.account()
    const writer = Keypair.random().publicKey()
    const { seed, keyId } = await openTab(
      reader,
      BigInt(5) * XLM,
      BigInt(5) * XLM
    )
    await send('tab_pause', tab(pauser).pause({ caller: pauser.publicKey() }))
    await expectContractError(
      tab(reader).deposit({ reader: reader.publicKey(), amount: XLM }),
      1000
    )
    const paused = await send(
      'settle_while_paused',
      tab(settler).settle({
        settler: settler.publicKey(),
        vouchers: [
          voucher(reader.publicKey(), writer, keyId, seed, XLM, rand(32)),
        ],
      })
    )
    expect(paused.result.settled).toBe(1)
    expect(paused.result.gross).toBe(XLM)
    expect(named(paused.res, tabId, 'tab_settled')).toHaveLength(1)
    // The reader keeps the exit while the Tab is paused.
    await send(
      'withdraw_start_while_paused',
      tab(reader).withdraw_start({ reader: reader.publicKey() })
    )
    await send('tab_unpause', tab(admin).unpause({ caller: admin.publicKey() }))
  })
})

describe('upgrade and migrate', () => {
  it('upgrades Core to a schema 2 build and migrates once', async () => {
    expect(upgradeWasm, 'QUILLTIP_CORE_UPGRADE_WASM').not.toBe('')
    // Only an upgrader changes the upgrader role; the admin alone cannot.
    await expectContractError(
      core(admin).grant_role({
        account: collector.publicKey(),
        role: 'upgrader',
        caller: admin.publicKey(),
      }),
      2000
    )
    await send(
      'grant_upgrader',
      core(upgrader).grant_role({
        account: collector.publicKey(),
        role: 'upgrader',
        caller: upgrader.publicKey(),
      })
    )
    await send(
      'revoke_upgrader',
      core(upgrader).revoke_role({
        account: collector.publicKey(),
        role: 'upgrader',
        caller: upgrader.publicKey(),
      })
    )
    const totalBefore = (
      await core(tipper).article_total({ article_id: A1, token })
    ).result
    const hash = h.uploadWasm(upgradeWasm, admin)
    const upgraded = await send(
      'core_upgrade',
      core(upgrader).upgrade({
        new_wasm_hash: Buffer.from(hash, 'hex'),
        operator: upgrader.publicKey(),
      })
    )
    // The host records the code change as a system event.
    expect(systemEventCount(upgraded.res)).toBeGreaterThan(0)
    const { res } = await send(
      'core_migrate',
      core(upgrader).migrate({ operator: upgrader.publicKey() })
    )
    const migrated = named(res, coreId, 'migrated')[0]!.data as Record<
      string,
      unknown
    >
    expect([migrated.from_version, migrated.to_version]).toEqual([1, 2])
    expect(await h.invokeRaw(coreId, 'upgrade_test_marker', [], admin)).toBe(2)
    await expectContractError(
      core(upgrader).migrate({ operator: upgrader.publicKey() }),
      14
    )
    // State survived: the article and its total are unchanged, and tips still work.
    expect(
      (await core(tipper).get_article({ article_id: A1 })).result?.author
    ).toBe(author.publicKey())
    expect(
      (await core(tipper).article_total({ article_id: A1, token })).result
    ).toBe(totalBefore)
    await send(
      'tip_after_upgrade',
      core(tipper).tip({
        tipper: tipper.publicKey(),
        article_id: A1,
        token,
        amount: XLM,
        highlight_id: null,
        client_ref: rand(16),
      })
    )
    expect(
      (await core(tipper).article_total({ article_id: A1, token })).result
    ).toBe(totalBefore! + XLM)
  })
})

describe('measurements', () => {
  it('settle at N = 1, 10, 25 and 32 distinct readers and writers', async () => {
    for (const n of [1, 10, 25, 32]) {
      const readers = await h.accounts(n)
      const opened = await openTabs(readers)
      const writers = readers.map(() => Keypair.random().publicKey())
      const vouchers = readers.map((r, i) =>
        voucher(
          r.publicKey(),
          writers[i]!,
          opened[i]!.keyId,
          opened[i]!.seed,
          XLM + BigInt(i),
          rand(32)
        )
      )
      // Cold: every pair and writer balance is a new ledger entry.
      const { res } = await send(
        `settle_n${n}`,
        tab(settler).settle({ settler: settler.publicKey(), vouchers })
      )
      expect(named(res, tabId, 'tab_settled')).toHaveLength(n)
      // Warm: the same pairs settle again with a higher cumulative total.
      const again = readers.map((r, i) =>
        voucher(
          r.publicKey(),
          writers[i]!,
          opened[i]!.keyId,
          opened[i]!.seed,
          BigInt(2) * XLM + BigInt(i),
          rand(32)
        )
      )
      const warm = await send(
        `settle_n${n}_warm`,
        tab(settler).settle({ settler: settler.publicKey(), vouchers: again })
      )
      expect(named(warm.res, tabId, 'tab_settled')).toHaveLength(n)
    }
    // settle_own at the cap: one writer, 32 readers.
    const writer = await h.account()
    const readers = await h.accounts(32)
    const opened = await openTabs(readers)
    const vouchers = readers.map((r, i) =>
      voucher(
        r.publicKey(),
        writer.publicKey(),
        opened[i]!.keyId,
        opened[i]!.seed,
        XLM,
        rand(32),
        true
      )
    )
    await send(
      'settle_own_n32',
      tab(writer).settle_own({ writer: writer.publicKey(), vouchers })
    )
  })

  it('tab flow against direct tips: 100 tips from one reader to 10 writers', async () => {
    const TIPS_PER_WRITER = 10
    const amount = XLM
    const writers = await h.accounts(10)
    // Direct: one transaction per tip, measured on the first writer's article.
    const articles = await Promise.all(
      writers.map(async (w, i) => {
        const { result } = await send(
          `register_reduction_${i}`,
          core(w).register_article({
            author: w.publicKey(),
            article_ref: articleRef(`reduction-${i}`),
            content_hash: rand(32),
            arweave_id: null,
            splits: [],
          })
        )
        return result
      })
    )
    let directFees = BigInt(0)
    let directTxs = 0
    for (let i = 0; i < TIPS_PER_WRITER; i++) {
      const { res } = await send(
        `direct_tip_${i}`,
        core(tipper).tip({
          tipper: tipper.publicKey(),
          article_id: articles[0]!,
          token,
          amount,
          highlight_id: null,
          client_ref: rand(16),
        })
      )
      directFees += res.resultXdr.feeCharged
      directTxs += 1
    }
    const directFeePerTip = directFees / BigInt(directTxs)
    // Tab: one open_session, 100 off-chain vouchers, one settle of 10 vouchers, 10 claims.
    const reader = await h.account()
    const before = measured.length
    const { seed, keyId } = await openTab(
      reader,
      BigInt(200) * XLM,
      BigInt(200) * XLM
    )
    const vouchers = writers.map((w) => {
      const receipts: TipReceiptFields[] = Array.from(
        { length: TIPS_PER_WRITER },
        (_, j) => ({
          amount,
          articleId: A1,
          clientRef: rand(16),
          contentHash: rand(32),
          cumulativeAfter: amount * BigInt(j + 1),
          highlightId: null,
          seq: j + 1,
        })
      )
      return voucher(
        reader.publicKey(),
        w.publicKey(),
        keyId,
        seed,
        amount * BigInt(TIPS_PER_WRITER),
        merkleRoot(receipts.map(receiptLeaf))
      )
    })
    await send(
      'reduction_settle',
      tab(settler).settle({ settler: settler.publicKey(), vouchers })
    )
    for (const [i, w] of writers.entries())
      await send(
        `reduction_claim_${i}`,
        tab(settler).claim({ recipient: w.publicKey() })
      )
    const tabRuns = measured.slice(before)
    const tabFees = tabRuns.reduce((s, m) => s + m.feeCharged, BigInt(0))
    const tips = writers.length * TIPS_PER_WRITER
    Object.assign(reduction, {
      tips,
      direct: {
        transactions: tips,
        feePerTipStroops: directFeePerTip,
        totalFeeStroops: directFeePerTip * BigInt(tips),
      },
      tab: {
        transactions: tabRuns.length,
        breakdown: { open_session: 1, settle: 1, claim: writers.length },
        // A reader who leaves recovers the rest with withdraw_start and
        // withdraw: two more transactions, not counted here.
        excludes: 'reader exit (withdraw_start and withdraw)',
        totalFeeStroops: tabFees,
      },
      transactionReduction: tips / tabRuns.length,
      transactionReductionWithoutClaims: tips / 2,
      feeReduction: Number(directFeePerTip * BigInt(tips)) / Number(tabFees),
    })
    expect(tabRuns.length).toBe(1 + 1 + writers.length)
  })
})
