/// <reference types="vite/client" />
/**
 * Article NFT mint and transfer through `convex/nftsV2.ts` against Core and
 * the NFT contract on a local standalone network
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.10; 06-app-integration.md,
 * sections 6.1 and 6.5).
 *
 * What runs for real:
 * - The Convex functions in convex-test: `getMintEligibility` (live views of
 *   the deployed Core and NFT contract), `prepareMint`, `prepareTransfer`,
 *   `chain.submissions.recordSubmitted`, the scheduled `verifySubmission`,
 *   `getNftSubmissionStatus`, the indexer's `ingestBackfill` with the Core
 *   and NFT handlers on the real `getEvents` page, `refreshChainConfig`,
 *   `getMintProgress` (the indexed reader view) and `getTokenMetadata`.
 * - The client step: `Nft.mint` and `Nft.transfer` built from the prepared
 *   values with the generated bindings, simulated, signed and sent.
 *
 * How the two sides meet: the backend network guard accepts TESTNET only, so
 * the Convex functions run with TESTNET settings. The one bridge is the
 * `fetch` the Convex RPC client uses: requests to the default testnet RPC URL
 * go to the local RPC instead. Any other non-local request fails the test, so
 * nothing reaches testnet. Transactions are built with the local passphrase.
 * The article is registered on Core here and its `chainArticles` row is
 * inserted directly (the registration flow has its own suite).
 *
 *   QUILLTIP_WASM_DIR=<dir with the three contract Wasm files> bunx vitest run \
 *     --config scripts/integration/nft-v2.config.mts
 */
import { join } from 'path'

import { Keypair, rpc } from '@stellar/stellar-sdk'
import { convexTest } from 'convex-test'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type {
  NftSubmissionStatus,
  PreparedNftMint,
  PreparedNftTransfer,
} from '../../convex/nftsV2'
import {
  articleIdHex,
  articleRefHex,
  hexToBytes,
} from '../../convex/lib/chain/ids'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import { STELLAR_NETWORK_DEFAULTS } from '../../convex/lib/stellarNetwork'
import { Client as CoreClient } from '../../lib/stellar/v2/bindings/core'
import { Client as NftClient } from '../../lib/stellar/v2/bindings/nft'
import { Harness, XLM } from './harness'

const modules = import.meta.glob('../../convex/**/*.ts')
const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const TESTNET_RPC = STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl!
const EPOCH = 'local-integration-nft'
const THRESHOLD = BigInt(5) * XLM

const h = new Harness()
const realFetch = globalThis.fetch
let admin: Keypair, treasury: Keypair, author: Keypair
let tipper: Keypair, collector: Keypair, outsider: Keypair
let token: string, coreId: string, nftId: string
let articleKey: string
let startLedger: number
let t: ReturnType<typeof convexTest>
let ids: {
  authorId: Id<'users'>
  collectorId: Id<'users'>
  articleId: Id<'articles'>
}
const core = (kp: Keypair) => new CoreClient(h.opts(coreId, kp))
const nft = (kp: Keypair) => new NftClient(h.opts(nftId, kp))
const localRpc = () =>
  createRpcClient({ url: h.net.rpcUrl, fetch: realFetch as RpcFetch })

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
    NFT_CONTRACT_ID: nftId,
    TOKEN_CONTRACT_ID: token,
    SITE_URL: 'http://localhost:3103',
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.stubGlobal('fetch', bridgeFetch)
}

const as = (userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

async function waitForTransaction(hash: string) {
  for (let i = 0; i < 60; i++) {
    const tx = await h.server.getTransaction(hash)
    if (tx.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return tx
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`transaction ${hash} not found`)
}

/** Client steps 2 to 5 from the prepared values only. */
async function buildAndSend(
  prepared: PreparedNftMint | PreparedNftTransfer,
  signer: Keypair
): Promise<string> {
  expect(prepared.signer).toBe(signer.publicKey())
  expect(prepared.contractId).toBe(nftId)
  const timeoutInSeconds = prepared.maxTime - Math.floor(Date.now() / 1000)
  expect(timeoutInSeconds).toBeGreaterThan(0)
  const client = nft(signer)
  const tx =
    prepared.method === 'mint'
      ? await client.mint(
          { article_id: hexToBytes(prepared.args.article_id) },
          { timeoutInSeconds }
        )
      : await client.transfer(prepared.args, { timeoutInSeconds })
  const sent = await tx.signAndSend()
  const hash = sent.sendTransactionResponse?.hash
  expect(hash).toMatch(/^[0-9a-f]{64}$/)
  const res = await waitForTransaction(hash!)
  expect(res.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
  return hash!
}

/** Client step 5, then server step 7, polled as the client does. */
async function recordAndVerify(
  userId: Id<'users'>,
  submissionId: Id<'chainSubmissions'>,
  hash: string
): Promise<NftSubmissionStatus> {
  const recorded = await as(userId).mutation(
    api.chain.submissions.recordSubmitted,
    { submissionId, txHash: hash }
  )
  expect(recorded).toMatchObject({ status: 'SUBMITTED', duplicate: false })
  for (let i = 0; i < 60; i++) {
    const status = (await as(userId).query(api.nftsV2.getNftSubmissionStatus, {
      submissionId,
    }))!
    if (status.status !== 'SUBMITTED') return status
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('verification did not finish')
}

/** The indexer step: stores the contracts' events from the local RPC. */
async function indexNftEvents(contractIds: string[] = [nftId]) {
  const page = await localRpc().getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds }],
    pagination: { limit: 1000 },
  })
  return t.mutation(internal.chain.indexer.ingestBackfill, {
    events: page.events,
  })
}

async function eligibility(userId: Id<'users'> | null = ids.authorId) {
  return (userId ? as(userId) : t).action(api.nftsV2.getMintEligibility, {
    articleId: ids.articleId,
  })
}

async function progress() {
  return t.query(api.nftsV2.getMintProgress, { articleId: ids.articleId })
}

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, treasury, author, tipper, collector, outsider] = (await h.accounts(
    6
  )) as [Keypair, Keypair, Keypair, Keypair, Keypair, Keypair]
  token = h.ensureNativeSac(admin)
  const roles = {
    admin: admin.publicKey(),
    pauser: admin.publicKey(),
    upgrader: admin.publicKey(),
  }
  coreId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_core.wasm'), admin),
    admin,
    { ...roles, treasury: treasury.publicKey(), token, min_tip: '1000000' }
  )
  nftId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_article_nft.wasm'), admin),
    admin,
    {
      ...roles,
      core: coreId,
      threshold_token: token,
      threshold: THRESHOLD.toString(),
      base_uri: 'http://localhost:3103/api/nft/',
    }
  )
  startLedger = (await h.server.getLatestLedger()).sequence

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
      usernameLower: 'writer',
      email: 'writer@example.test',
      stellarAddress: author.publicKey(),
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const collectorId = await db.insert('users', {
      username: 'collector',
      usernameLower: 'collector',
      email: 'collector@example.test',
      stellarAddress: collector.publicKey(),
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await db.insert('articles', {
      slug: 'nft-article',
      title: 'An article worth keeping',
      excerpt: 'Kept on Stellar.',
      content: { type: 'doc', content: [] },
      published: true,
      authorId,
      authorUsername: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    return { authorId, collectorId, articleId }
  })

  // Register the article on Core with its app reference, then record it as
  // the registration flow would.
  const ref = await articleRefHex(ids.articleId)
  const contentHash = crypto.getRandomValues(new Uint8Array(32))
  const reg = await core(author).register_article({
    author: author.publicKey(),
    article_ref: hexToBytes(ref),
    content_hash: contentHash,
    arweave_id: null,
    splits: [],
  })
  await reg.signAndSend()
  articleKey = await articleIdHex(author.publicKey(), ref)
  await t.run(async ({ db }) => {
    await db.insert('chainArticles', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      articleId: ids.articleId,
      articleKey,
      authorAddress: author.publicKey(),
      contentHash: Array.from(contentHash, (b) =>
        b.toString(16).padStart(2, '0')
      ).join(''),
      contentVersion: 1,
      splits: [],
      totals: {},
      status: 'REGISTERED',
      updatedAt: Date.now(),
    })
  })
}, 600_000)

describe('5.10 NFT through nftsV2', () => {
  let tokenId: number
  let nftRowId: Id<'articleNFTs'>

  it('reads eligibility live: below the threshold, then eligible', async () => {
    // The reader view comes from the cached config and indexed totals.
    await t.action(internal.chain.config.refreshChainConfig, {})
    expect(await progress()).toMatchObject({
      state: 'NOT_MINTED',
      thresholdToken: token,
      threshold: THRESHOLD.toString(),
      total: '0',
      reached: false,
      paused: false,
    })
    expect(await eligibility()).toMatchObject({
      state: 'BELOW_THRESHOLD',
      articleKey,
      thresholdToken: token,
      threshold: THRESHOLD.toString(),
      total: '0',
      remaining: THRESHOLD.toString(),
      onChainAuthor: author.publicKey(),
      paused: false,
    })
    const tip = await core(tipper).tip({
      tipper: tipper.publicKey(),
      article_id: hexToBytes(articleKey),
      token,
      amount: THRESHOLD,
      highlight_id: null,
      client_ref: crypto.getRandomValues(new Uint8Array(16)),
    })
    await tip.signAndSend()
    expect(await eligibility()).toMatchObject({
      state: 'ELIGIBLE',
      total: THRESHOLD.toString(),
      remaining: '0',
    })
    expect((await eligibility(ids.collectorId)).state).toBe('NOT_AUTHOR')
    expect((await eligibility(null)).state).toBe('SIGNED_OUT')

    const indexed = await indexNftEvents([coreId])
    expect(indexed.byResult.error ?? 0).toBe(0)
    expect(await progress()).toMatchObject({
      state: 'NOT_MINTED',
      total: THRESHOLD.toString(),
      remaining: '0',
      reached: true,
    })
  })

  it('mints through prepare, record, verify and the indexer', async () => {
    const prepared = await as(ids.authorId).mutation(api.nftsV2.prepareMint, {
      articleId: ids.articleId,
      requestId: 'local-mint-1',
    })
    expect(prepared).toMatchObject({
      action: 'mint',
      method: 'mint',
      contractId: nftId,
      signer: author.publicKey(),
      args: { article_id: articleKey },
      existing: false,
    })
    const hash = await buildAndSend(prepared, author)
    const verified = await recordAndVerify(
      ids.authorId,
      prepared.submissionId,
      hash
    )
    expect(verified).toMatchObject({
      action: 'mint',
      status: 'CONFIRMED',
      txHash: hash,
      canRetry: false,
      indexed: false,
    })

    const ingest = await indexNftEvents()
    expect(ingest.byResult.error ?? 0).toBe(0)
    const status = (await as(ids.authorId).query(
      api.nftsV2.getNftSubmissionStatus,
      { submissionId: prepared.submissionId }
    ))!
    expect(status).toMatchObject({
      status: 'CONFIRMED',
      indexed: true,
      nft: { ownerAddress: author.publicKey(), contractId: nftId },
    })
    tokenId = status.nft!.tokenId
    nftRowId = status.nft!.nftId
    expect((await nft(author).owner_of({ token_id: tokenId })).result).toBe(
      author.publicKey()
    )
    expect(await eligibility()).toMatchObject({ state: 'MINTED', tokenId })
    expect(await progress()).toMatchObject({
      state: 'MINTED',
      tokenId,
      nftId: nftRowId,
      ownerAddress: author.publicKey(),
    })
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId })
    ).toMatchObject({
      available: true,
      title: 'An article worth keeping',
      minterAddress: author.publicKey(),
      network: 'TESTNET',
    })
    const tokenUri = (await nft(author).token_uri({ token_id: tokenId })).result
    expect(tokenUri).toBe(`http://localhost:3103/api/nft/${tokenId}`)
    const row = await t.run(({ db }) => db.get(nftRowId))
    expect(row!.metadataUrl).toBe(tokenUri)
  })

  it('transfers to a QuillTip user resolved to their verified address', async () => {
    const prepared = await as(ids.authorId).mutation(
      api.nftsV2.prepareTransfer,
      {
        nftId: nftRowId,
        recipient: { kind: 'user', username: 'collector' },
        requestId: 'local-transfer-1',
      }
    )
    expect(prepared.args).toEqual({
      from: author.publicKey(),
      to: collector.publicKey(),
      token_id: tokenId,
    })
    const hash = await buildAndSend(prepared, author)
    expect(
      await recordAndVerify(ids.authorId, prepared.submissionId, hash)
    ).toMatchObject({ status: 'CONFIRMED', indexed: false })
    // Ownership moves only with the indexed event.
    let row = await t.run(({ db }) => db.get(nftRowId))
    expect(row!.ownerAddress).toBe(author.publicKey())
    await indexNftEvents()
    row = await t.run(({ db }) => db.get(nftRowId))
    expect(row).toMatchObject({
      ownerAddress: collector.publicKey(),
      currentOwner: ids.collectorId,
    })
  })

  it('transfers to an address outside QuillTip', async () => {
    const prepared = await as(ids.collectorId).mutation(
      api.nftsV2.prepareTransfer,
      {
        nftId: nftRowId,
        recipient: { kind: 'address', address: outsider.publicKey() },
        requestId: 'local-transfer-2',
      }
    )
    const hash = await buildAndSend(prepared, collector)
    expect(
      await recordAndVerify(ids.collectorId, prepared.submissionId, hash)
    ).toMatchObject({ status: 'CONFIRMED' })
    // A replayed page changes nothing.
    await indexNftEvents()
    const again = await indexNftEvents()
    expect(again.stored).toBe(0)
    const row = await t.run(({ db }) => db.get(nftRowId))
    expect(row!.ownerAddress).toBe(outsider.publicKey())
    expect(row!.currentOwner).toBeUndefined()
    const history = await t.run(async ({ db }) =>
      (await db.query('nftTransfers').collect()).filter(
        (r) => r.nftId === nftRowId
      )
    )
    expect(history.map((r) => [r.fromAddress, r.toAddress])).toEqual([
      [author.publicKey(), collector.publicKey()],
      [collector.publicKey(), outsider.publicKey()],
    ])
    expect(history[1]!.toUserId).toBeUndefined()
    expect((await nft(outsider).owner_of({ token_id: tokenId })).result).toBe(
      outsider.publicKey()
    )
  })
})
