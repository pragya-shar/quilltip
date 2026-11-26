/// <reference types="vite/client" />
/**
 * Direct, highlight and batch tips through `convex/tipsV2.ts` against Core on
 * a local standalone network (docs/architecture/v2/05-flows-and-admin.md,
 * sections 5.2 to 5.4; 06-app-integration.md, section 6.1).
 *
 * What runs for real:
 * - The Convex functions in convex-test: `prepareDirectTip`,
 *   `prepareHighlightTip`, `prepareBatch`, `recordSubmitted`, the scheduled
 *   `verifySubmission` and `getTipStatus`. `refreshChainConfig` reads
 *   `min_tip` and the pause state from the deployed Core.
 * - The client step: `Core.tip` and `Core.tip_batch` built from the prepared
 *   values with the generated bindings, simulated, signed and sent.
 * - The server verifier on the real `getTransaction` events.
 *
 * How the two sides meet: the backend network guard accepts TESTNET only, so
 * the Convex functions run with TESTNET settings. The one bridge is the
 * `fetch` the Convex RPC client uses: requests to the default testnet RPC URL
 * go to the local RPC instead. Any other non-local request fails the test, so
 * nothing reaches testnet. Transactions are built with the local passphrase.
 * The Core article records are registered on chain here and the matching
 * `chainArticles` rows are inserted directly (the registration flow has its
 * own suite).
 *
 *   QUILLTIP_WASM_DIR=<dir with quilltip_core.wasm> bunx vitest run \
 *     --config scripts/integration/tips-v2.config.mts
 */
import { join } from 'path'

import { Keypair, rpc } from '@stellar/stellar-sdk'
import { convexTest } from 'convex-test'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  articleIdHex,
  articleRefHex,
  hexToBytes,
} from '../../convex/lib/chain/ids'
import type { PreparedTip } from '../../convex/lib/chain/tipPrepare'
import { STELLAR_NETWORK_DEFAULTS } from '../../convex/lib/stellarNetwork'
import { Client as CoreClient } from '../../lib/stellar/v2/bindings/core'
import { Harness, XLM } from './harness'
import type { RequestedTipItem } from '../../lib/stellar/v2/tip-calls'

const modules = import.meta.glob('../../convex/**/*.ts')
const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const TESTNET_RPC = STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl!
const EPOCH = 'local-integration'
const PRICE = 0.25
const HL_TEXT = 'The quick brown fox jumps over the lazy dog'
const BODY = `Opening line. ${HL_TEXT}. Closing line.`
const HL_START = BODY.indexOf(HL_TEXT)

const h = new Harness()
const realFetch = globalThis.fetch
let admin: Keypair, treasury: Keypair, author: Keypair
let coauthor: Keypair, tipper: Keypair
let token: string, coreId: string
let t: ReturnType<typeof convexTest>
let ids: {
  authorId: Id<'users'>
  tipperId: Id<'users'>
  plainId: Id<'articles'>
  splitId: Id<'articles'>
}
const core = (kp: Keypair) => new CoreClient(h.opts(coreId, kp))
const fee = (gross: bigint) => (gross * BigInt(250)) / BigInt(10_000)

/** The Convex RPC client's view: testnet URL in, local RPC out. */
function bridgeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input.toString()
  if (url === TESTNET_RPC) return realFetch(h.net.rpcUrl, init)
  const host = new URL(url).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`Refusing a non-local request to ${url}`)
  }
  return realFetch(input, init)
}

function stubConvexEnv() {
  const env: Record<string, string> = {
    STELLAR_NETWORK: 'TESTNET',
    NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: '',
    STELLAR_RPC_URL: '',
    QUILLTIP_NETWORK_GUARD_OPT_IN: '',
    CONVEX_DEPLOYMENT: '',
    NEXT_PUBLIC_CONVEX_URL: '',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    CORE_CONTRACT_ID: coreId,
    TOKEN_CONTRACT_ID: token,
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.stubGlobal('fetch', bridgeFetch)
}

function asTipper() {
  return t.withIdentity({ subject: `${ids.tipperId}|session` })
}

async function waitForTransaction(hash: string) {
  for (let i = 0; i < 60; i++) {
    const tx = await h.server.getTransaction(hash)
    if (tx.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return tx
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`transaction ${hash} not found`)
}

/** Client steps 2 to 5 from the prepared values only. */
async function buildAndSend(prepared: PreparedTip): Promise<string> {
  const timeoutInSeconds = prepared.maxTime - Math.floor(Date.now() / 1000)
  expect(timeoutInSeconds).toBeGreaterThan(0)
  const items = prepared.items.map(({ tipInput }) => ({
    article_id: hexToBytes(tipInput.article_id),
    amount: BigInt(tipInput.amount),
    highlight_id: tipInput.highlight_id
      ? hexToBytes(tipInput.highlight_id)
      : null,
    client_ref: hexToBytes(tipInput.client_ref),
  }))
  const client = core(tipper)
  const tx =
    prepared.method === 'tip'
      ? await client.tip(
          {
            tipper: prepared.tipperAddress,
            token: prepared.tokenContractId,
            ...items[0]!,
          },
          { timeoutInSeconds }
        )
      : await client.tip_batch(
          {
            tipper: prepared.tipperAddress,
            token: prepared.tokenContractId,
            items,
          },
          { timeoutInSeconds }
        )
  const sent = await tx.signAndSend()
  const hash = sent.sendTransactionResponse?.hash
  expect(hash).toMatch(/^[0-9a-f]{64}$/)
  const res = await waitForTransaction(hash!)
  expect(res.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
  return hash!
}

/**
 * Client step 5, then server step 7: the scheduled verifier runs on real
 * timers (the RPC client's request timeout needs them), and the test polls
 * `getTipStatus` as the client does.
 */
async function recordAndVerify(prepared: PreparedTip, hash: string) {
  const recorded = await asTipper().mutation(api.tipsV2.recordSubmitted, {
    submissionId: prepared.submissionId,
    txHash: hash,
  })
  expect(recorded).toMatchObject({ status: 'SUBMITTED', duplicate: false })
  for (let i = 0; i < 60; i++) {
    const status = (await asTipper().query(api.tipsV2.getTipStatus, {
      submissionId: prepared.submissionId,
    }))!
    if (status.uiState !== 'checking') return status
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('verification did not finish')
}

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, treasury, author, coauthor, tipper] = (await h.accounts(5)) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ]
  token = h.ensureNativeSac(admin)
  const coreHash = h.uploadWasm(join(wasmDir, 'quilltip_core.wasm'), admin)
  coreId = h.deploy(coreHash, admin, {
    admin: admin.publicKey(),
    pauser: admin.publicKey(),
    upgrader: admin.publicKey(),
    treasury: treasury.publicKey(),
    token,
    min_tip: '1000000',
  })

  stubConvexEnv()
  t = convexTest(schema, modules)
  const now = Date.now()
  const verified = {
    stellarAddressVerifiedAt: now,
    stellarAddressVerifiedNetwork: TESTNET_PASSPHRASE,
  }
  ids = await t.run(async ({ db }) => {
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: author.publicKey(),
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const tipperId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      stellarAddress: tipper.publicKey(),
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const article = (slug: string) =>
      db.insert('articles', {
        slug,
        title: slug,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: BODY }] },
          ],
        },
        published: true,
        authorId,
        authorUsername: 'writer',
        createdAt: now,
        updatedAt: now,
      })
    const plainId = await article('plain-article')
    const splitId = await article('split-article')
    await db.insert('xlmPriceCache', {
      priceUsd: PRICE,
      source: 'Fixture',
      fetchedAt: now,
    })
    return { authorId, tipperId, plainId, splitId }
  })

  // Register both articles on Core with their app references, then record
  // them as the registration flow would.
  const splits = [
    { recipient: author.publicKey(), bps: 7_000 },
    { recipient: coauthor.publicKey(), bps: 3_000 },
  ]
  for (const [articleId, articleSplits] of [
    [ids.plainId, []],
    [ids.splitId, splits],
  ] as const) {
    const ref = await articleRefHex(articleId)
    const tx = await core(author).register_article({
      author: author.publicKey(),
      article_ref: hexToBytes(ref),
      content_hash: crypto.getRandomValues(new Uint8Array(32)),
      arweave_id: null,
      splits: [...articleSplits],
    })
    await tx.signAndSend()
    const articleKey = await articleIdHex(author.publicKey(), ref)
    await t.run((ctx) =>
      ctx.db.insert('chainArticles', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        articleId,
        articleKey,
        authorAddress: author.publicKey(),
        contentHash: 'ab'.repeat(32),
        contentVersion: 1,
        splits: [...articleSplits],
        totals: {},
        status: 'REGISTERED',
        updatedAt: Date.now(),
      })
    )
  }

  // The hourly config refresh, against the local Core.
  await t.action(internal.chain.config.refreshChainConfig, {})
  const latestLedger = await h.latestLedger()
  await t.run((ctx) =>
    ctx.db.insert('chainCursor', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      lastLedger: latestLedger,
      lastLedgerCloseTime: Math.floor(Date.now() / 1000),
      latestLedger,
      oldestLedger: 1,
      lagLedgers: 0,
      status: 'OK',
      updatedAt: Date.now(),
    })
  )
}, 600_000)

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('tipsV2 against Core on a local network', () => {
  it('caches min_tip and the pause state from the deployed Core', async () => {
    const config = await t.run((ctx) => ctx.db.query('chainConfig').first())
    expect(config).toMatchObject({
      coreContractId: coreId,
      tokenContractId: token,
      minTip: '1000000',
      feeBps: 250,
      paused: { core: false },
    })
    const eligibility = await asTipper().query(api.tipsV2.getTipEligibility, {
      articleId: ids.splitId,
    })
    expect(eligibility).toMatchObject({
      eligible: true,
      recipientCount: 2,
      transferCount: 3,
      minTipBaseUnits: '1000000',
      minTipCents: 3,
    })
  })

  it('direct tip: prepare, send, record, verify, CONFIRMED with chain amounts', async () => {
    const prepared = await asTipper().mutation(api.tipsV2.prepareDirectTip, {
      requestId: `direct-${Date.now()}`,
      articleId: ids.plainId,
      amountCents: 100,
    })
    expect(prepared).toMatchObject({
      method: 'tip',
      contractId: coreId,
      tokenContractId: token,
      tipperAddress: tipper.publicKey(),
    })
    const gross = BigInt(prepared.items[0]!.tipInput.amount)
    expect(gross).toBe(BigInt(4) * XLM)
    const [a0, f0] = [
      await h.balance(author.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const hash = await buildAndSend(prepared)
    const status = await recordAndVerify(prepared, hash)
    expect(status).toMatchObject({
      status: 'CONFIRMED',
      uiState: 'confirmed',
      canRetry: false,
      txHash: hash,
      chainTotals: {
        grossBaseUnits: gross.toString(),
        feeBaseUnits: fee(gross).toString(),
        netBaseUnits: (gross - fee(gross)).toString(),
      },
    })
    expect(status.items[0]!.chain).toMatchObject({
      authorAddress: author.publicKey(),
      tipperAddress: tipper.publicKey(),
      tokenContractId: token,
    })
    expect(await h.balance(author.publicKey())).toBe(a0 + gross - fee(gross))
    expect(await h.balance(treasury.publicKey())).toBe(f0 + fee(gross))
    // The same hash again is accepted once only.
    expect(
      await asTipper().mutation(api.tipsV2.recordSubmitted, {
        tipId: prepared.items[0]!.tipId,
        txHash: hash,
      })
    ).toMatchObject({ status: 'CONFIRMED', duplicate: true })
  })

  it('highlight tip carries the derived highlight_id on chain', async () => {
    const prepared = await asTipper().mutation(api.tipsV2.prepareHighlightTip, {
      requestId: `highlight-${Date.now()}`,
      articleId: ids.plainId,
      amountCents: 50,
      highlight: {
        text: HL_TEXT,
        startOffset: HL_START,
        endOffset: HL_START + HL_TEXT.length,
      },
    })
    expect(prepared.items[0]!.tipInput.highlight_id).toMatch(/^[0-9a-f]{64}$/)
    const hash = await buildAndSend(prepared)
    const status = await recordAndVerify(prepared, hash)
    expect(status).toMatchObject({ status: 'CONFIRMED', uiState: 'confirmed' })
    expect(status.items[0]!.table).toBe('highlightTips')
  })

  it('batch: one tip_batch, every item matched by client_ref and CONFIRMED', async () => {
    const prepared = await asTipper().mutation(api.tipsV2.prepareBatch, {
      requestId: `batch-${Date.now()}`,
      items: [
        { articleId: ids.plainId, amountCents: 40 },
        {
          articleId: ids.plainId,
          amountCents: 30,
          highlight: {
            text: HL_TEXT,
            startOffset: HL_START,
            endOffset: HL_START + HL_TEXT.length,
          },
        },
        { articleId: ids.splitId, amountCents: 100 },
      ],
    })
    expect(prepared.method).toBe('tip_batch')
    const grosses = prepared.items.map((i) => BigInt(i.tipInput.amount))
    const [a0, c0, f0] = [
      await h.balance(author.publicKey()),
      await h.balance(coauthor.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const hash = await buildAndSend(prepared)
    const status = await recordAndVerify(prepared, hash)
    expect(status).toMatchObject({
      method: 'tip_batch',
      status: 'CONFIRMED',
      uiState: 'confirmed',
      txHash: hash,
    })
    expect(status.items.map((i) => i.status)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
    ])
    // Fees are per item; the split article pays the co-author 30% of net.
    const fees = grosses.map(fee)
    const splitNet = grosses[2]! - fees[2]!
    const coShare = (splitNet * BigInt(3_000)) / BigInt(10_000)
    const authorGain =
      grosses[0]! - fees[0]! + (grosses[1]! - fees[1]!) + (splitNet - coShare)
    expect(await h.balance(author.publicKey())).toBe(a0 + authorGain)
    expect(await h.balance(coauthor.publicKey())).toBe(c0 + coShare)
    expect(await h.balance(treasury.publicKey())).toBe(
      f0 + fees.reduce((a, b) => a + b, BigInt(0))
    )
  })
})

/**
 * The client side of the same flows: `runTip` (lib/stellar/v2/tip-actions.ts)
 * prepares through `tipsV2`, checks the response, builds `Core.tip` or
 * `Core.tip_batch` with `tipContractCall`, simulates, signs with the test key
 * and sends through `sendContractCall`, then records the hash. The test
 * follows `getTipStatus` as the UI does and checks the split on chain.
 *
 * The one bridge: Convex runs with TESTNET settings (the backend guard), so
 * the prepare response names the testnet passphrase. The test gives the
 * runner the local passphrase as its configuration and rewrites the response
 * to match, as a LOCAL deployment would return it.
 */
describe('the client tip runner against Core on a local network', () => {
  const LOCAL = 'Standalone Network ; February 2017'

  async function runClientTip(
    prepare: (requestId: string) => Promise<PreparedTip>,
    request: RequestedTipItem[],
    options: { refuse?: boolean } = {}
  ) {
    const { runTip } = await import('../../lib/stellar/v2/tip-actions')
    const { WalletError } = await import('../../lib/stellar/v2/wallet-errors')
    const { TransactionBuilder } = await import('@stellar/stellar-sdk')
    const steps: string[] = []
    const result = await runTip({
      config: {
        passphrase: LOCAL,
        coreContractId: coreId,
        tokenContractId: token,
      },
      server: h.server,
      request,
      requestId: `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      prepare: async (requestId) => ({
        ...(await prepare(requestId)),
        networkPassphrase: LOCAL,
      }),
      connect: async () => tipper.publicKey(),
      sign: async (envelope, address) => {
        expect(address).toBe(tipper.publicKey())
        if (options.refuse) throw new WalletError('rejected', 'declined')
        const tx = TransactionBuilder.fromXDR(envelope, LOCAL)
        tx.sign(tipper)
        return tx.toXDR()
      },
      recordSubmitted: async (submissionId, txHash) => {
        await asTipper().mutation(api.tipsV2.recordSubmitted, {
          submissionId: submissionId as Id<'chainSubmissions'>,
          txHash,
        })
      },
      recordSendFailed: async (submissionId, reason, detail) => {
        await asTipper().mutation(api.tipsV2.recordSendFailed, {
          submissionId: submissionId as Id<'chainSubmissions'>,
          reason,
          ...(detail ? { detail } : {}),
        })
      },
      onStep: (step) => steps.push(step),
    })
    return { result, steps }
  }

  /** Follows `getTipStatus` until the server reports a final state. */
  async function follow(submissionId: string) {
    for (let i = 0; i < 120; i++) {
      const status = (await asTipper().query(api.tipsV2.getTipStatus, {
        submissionId: submissionId as Id<'chainSubmissions'>,
      }))!
      if (status.uiState !== 'checking') return status
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error('the server did not reach a final state')
  }

  it('direct tip: the writer receives 97.5% and the platform 2.5%', async () => {
    const articleKey = await articleIdHex(
      author.publicKey(),
      await articleRefHex(ids.plainId)
    )
    const [a0, f0] = [
      await h.balance(author.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const { result, steps } = await runClientTip(
      (requestId) =>
        asTipper().mutation(api.tipsV2.prepareDirectTip, {
          requestId,
          articleId: ids.plainId,
          amountCents: 200,
        }),
      [{ articleId: ids.plainId, articleKey }]
    )
    expect(steps).toEqual(['simulating', 'signing', 'sending'])
    expect(result.kind).toBe('sent')
    if (result.kind !== 'sent') return
    expect(result.recorded).toBe(true)
    const status = await follow(result.prepared.submissionId)
    const gross = BigInt(result.prepared.items[0]!.tipInput.amount)
    expect(gross).toBe(BigInt(8) * XLM)
    expect(status).toMatchObject({
      status: 'CONFIRMED',
      uiState: 'confirmed',
      canRetry: false,
      txHash: result.txHash,
    })
    // 97.5% to the writer and 2.5% to the platform, to the stroop.
    expect(fee(gross)).toBe((gross * BigInt(25)) / BigInt(1_000))
    expect(await h.balance(author.publicKey())).toBe(a0 + gross - fee(gross))
    expect(await h.balance(treasury.publicKey())).toBe(f0 + fee(gross))
    expect(status.chainTotals).toEqual({
      grossBaseUnits: gross.toString(),
      feeBaseUnits: fee(gross).toString(),
      netBaseUnits: (gross - fee(gross)).toString(),
    })
  })

  it('highlight tip: the local highlight_id check passes and it confirms', async () => {
    const [a0, f0] = [
      await h.balance(author.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const passage = {
      text: HL_TEXT,
      startOffset: HL_START,
      endOffset: HL_START + HL_TEXT.length,
    }
    const { result } = await runClientTip(
      (requestId) =>
        asTipper().mutation(api.tipsV2.prepareHighlightTip, {
          requestId,
          articleId: ids.plainId,
          amountCents: 40,
          highlight: passage,
        }),
      [
        {
          articleId: ids.plainId,
          highlight: { articleSlug: 'plain-article', ...passage },
        },
      ]
    )
    expect(result.kind).toBe('sent')
    if (result.kind !== 'sent') return
    const status = await follow(result.prepared.submissionId)
    expect(status).toMatchObject({ status: 'CONFIRMED', uiState: 'confirmed' })
    expect(status.items[0]!.table).toBe('highlightTips')
    const gross = BigInt(result.prepared.items[0]!.tipInput.amount)
    expect(await h.balance(author.publicKey())).toBe(a0 + gross - fee(gross))
    expect(await h.balance(treasury.publicKey())).toBe(f0 + fee(gross))
  })

  it('batch: one tip_batch, each item confirmed, 97.5% / 2.5% per tip', async () => {
    const passage = {
      text: HL_TEXT,
      startOffset: HL_START,
      endOffset: HL_START + HL_TEXT.length,
    }
    const [a0, c0, f0] = [
      await h.balance(author.publicKey()),
      await h.balance(coauthor.publicKey()),
      await h.balance(treasury.publicKey()),
    ]
    const { result } = await runClientTip(
      (requestId) =>
        asTipper().mutation(api.tipsV2.prepareBatch, {
          requestId,
          items: [
            { articleId: ids.plainId, amountCents: 60 },
            { articleId: ids.plainId, amountCents: 30, highlight: passage },
            { articleId: ids.splitId, amountCents: 120 },
          ],
        }),
      [
        { articleId: ids.plainId },
        {
          articleId: ids.plainId,
          highlight: { articleSlug: 'plain-article', ...passage },
        },
        { articleId: ids.splitId },
      ]
    )
    expect(result.kind).toBe('sent')
    if (result.kind !== 'sent') return
    expect(result.prepared.method).toBe('tip_batch')
    const status = await follow(result.prepared.submissionId)
    expect(status).toMatchObject({
      method: 'tip_batch',
      status: 'CONFIRMED',
      uiState: 'confirmed',
    })
    expect(status.items.map((i) => i.uiState)).toEqual([
      'confirmed',
      'confirmed',
      'confirmed',
    ])
    const grosses = result.prepared.items.map((i) => BigInt(i.tipInput.amount))
    const fees = grosses.map(fee)
    const splitNet = grosses[2]! - fees[2]!
    const coShare = (splitNet * BigInt(3_000)) / BigInt(10_000)
    expect(await h.balance(author.publicKey())).toBe(
      a0 + grosses[0]! - fees[0]! + (grosses[1]! - fees[1]!) + splitNet - coShare
    )
    expect(await h.balance(coauthor.publicKey())).toBe(c0 + coShare)
    expect(await h.balance(treasury.publicKey())).toBe(
      f0 + fees.reduce((a, b) => a + b, BigInt(0))
    )
  })

  it('a wallet refusal is recorded FAILED with a retry; nothing moves', async () => {
    const [a0, t0] = [
      await h.balance(author.publicKey()),
      await h.balance(tipper.publicKey()),
    ]
    const { result } = await runClientTip(
      (requestId) =>
        asTipper().mutation(api.tipsV2.prepareDirectTip, {
          requestId,
          articleId: ids.plainId,
          amountCents: 100,
        }),
      [{ articleId: ids.plainId }],
      { refuse: true }
    )
    expect(result).toMatchObject({
      kind: 'stopped',
      view: { show: { kind: 'declined' } },
    })
    if (result.kind !== 'stopped') return
    const status = await asTipper().query(api.tipsV2.getTipStatus, {
      submissionId: result.prepared.submissionId,
    })
    expect(status).toMatchObject({
      status: 'FAILED',
      uiState: 'failed',
      canRetry: true,
    })
    expect(status!.items[0]!.failureReason).toBe('wallet_rejected: rejected')
    expect(await h.balance(author.publicKey())).toBe(a0)
    expect(await h.balance(tipper.publicKey())).toBe(t0)
  })
})
