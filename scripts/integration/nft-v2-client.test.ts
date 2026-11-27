/// <reference types="vite/client" />
/**
 * The client side of the v2 article NFT (lib/stellar/v2/nft-calls.ts,
 * nft-actions.ts, lib/nft/v2-flow.ts) against Core and the NFT contract on a
 * local standalone network (docs/architecture/v2/05-flows-and-admin.md,
 * section 5.10).
 *
 * What runs for real:
 * - The client: `checkPreparedNftCall`, `nftContractCall` and `runNftCall`
 *   (build, simulate, sign with a test key, send, record the hash), with the
 *   real RPC client and `sendContractCall`. A mint below the threshold fails
 *   in simulation and is decoded as the NFT contract's `BelowThreshold`.
 * - The server, in convex-test: `prepareMint`, `prepareTransfer`,
 *   `chain.submissions.recordSubmitted` and `recordSendFailed`, the scheduled
 *   verification, `getNftSubmissionStatus`, the indexer's `ingestBackfill`
 *   on the real `getEvents` page, and the reader view `getMintProgress`.
 * - The panel state (`deriveNftPanel`) from those server answers.
 * - The owner on chain (`owner_of`) after each step.
 *
 * How the two sides meet (as in scripts/integration/nft-v2.test.ts): the
 * backend network guard accepts TESTNET only, so the Convex functions run
 * with TESTNET settings and the Convex RPC client's testnet URL is bridged to
 * the local RPC. The prepared response therefore names the testnet
 * passphrase; the client builds with the local one, which is the only value
 * this test changes before signing. Any other non-local request fails.
 *
 *   QUILLTIP_WASM_DIR=<dir with the contract Wasm files> bunx vitest run \
 *     --config scripts/integration/nft-v2.config.mts
 */
import { join } from 'path'

import {
  Keypair,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import { convexTest } from 'convex-test'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  articleIdHex,
  articleRefHex,
  hexToBytes,
} from '../../convex/lib/chain/ids'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import { STELLAR_NETWORK_DEFAULTS } from '../../convex/lib/stellarNetwork'
import { Client as CoreClient } from '../../lib/stellar/v2/bindings/core'
import { Client as NftClient } from '../../lib/stellar/v2/bindings/nft'
import {
  checkRecipient,
  type NftCallExpectation,
  type PreparedNftCall,
} from '../../lib/stellar/v2/nft-calls'
import { runNftCall, type NftRunResult } from '../../lib/stellar/v2/nft-actions'
import {
  deriveNftPanel,
  isSettled,
  type NftSubmissionStatusLike,
} from '../../lib/nft/v2-flow'
import { Harness, LOCAL_PASSPHRASE, XLM } from './harness'

const modules = import.meta.glob('../../convex/**/*.ts')
const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const TESTNET_RPC = STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl!
const EPOCH = 'local-integration-nft-client'
const THRESHOLD = BigInt(5) * XLM
/** Core's minimum tip in this deployment (0.1 XLM). */
const MIN_TIP = BigInt(1_000_000)

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
    SITE_URL: 'http://localhost:3122',
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.stubGlobal('fetch', bridgeFetch)
}

const as = (userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

/** The server's prepared call, built for the local network. */
function local<T extends PreparedNftCall>(prepared: T): T {
  expect(prepared.networkPassphrase).toBe(TESTNET_PASSPHRASE)
  return { ...prepared, networkPassphrase: LOCAL_PASSPHRASE }
}

const contracts = () => ({ core: coreId, nft: nftId, token })

/** `runNftCall` with the real RPC, a test key and the Convex record calls. */
async function run(
  userId: Id<'users'>,
  prepared: PreparedNftCall,
  expected: NftCallExpectation,
  signer: Keypair
): Promise<NftRunResult> {
  return runNftCall({
    prepared,
    expected,
    server: h.server,
    contracts: contracts(),
    connect: async () => signer.publicKey(),
    sign: async (envelope) => {
      const tx = TransactionBuilder.fromXDR(
        envelope,
        LOCAL_PASSPHRASE
      ) as Transaction
      tx.sign(signer)
      return tx.toXDR()
    },
    recordSubmitted: async (submissionId, txHash) => {
      await as(userId).mutation(api.chain.submissions.recordSubmitted, {
        submissionId: submissionId as Id<'chainSubmissions'>,
        txHash,
      })
    },
    recordFailed: async (submissionId, reason, detail) => {
      await as(userId).mutation(api.chain.submissions.recordSendFailed, {
        submissionId: submissionId as Id<'chainSubmissions'>,
        reason,
        ...(detail ? { detail } : {}),
      })
    },
  })
}

/** Follows the server record as the panel does, until it is final for the UI. */
async function follow(
  userId: Id<'users'>,
  submissionId: string,
  index: () => Promise<unknown>
): Promise<NftSubmissionStatusLike> {
  for (let i = 0; i < 120; i++) {
    const status = (await as(userId).query(api.nftsV2.getNftSubmissionStatus, {
      submissionId: submissionId as Id<'chainSubmissions'>,
    })) as NftSubmissionStatusLike
    if (isSettled(status)) return status
    // Confirmed by RPC: the indexer applies the event next.
    if (status.status === 'CONFIRMED') await index()
    else await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('the record did not settle')
}

async function indexEvents() {
  const page = await localRpc().getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [coreId, nftId] }],
    pagination: { limit: 1000 },
  })
  const result = await t.mutation(internal.chain.indexer.ingestBackfill, {
    events: page.events,
  })
  expect(result.byResult.error ?? 0).toBe(0)
  return result
}

async function tip(amount: bigint) {
  const tx = await core(tipper).tip({
    tipper: tipper.publicKey(),
    article_id: hexToBytes(articleKey),
    token,
    amount,
    highlight_id: null,
    client_ref: crypto.getRandomValues(new Uint8Array(16)),
  })
  await tx.signAndSend()
}

async function panelFor(
  userId: Id<'users'> | null,
  verifiedAddress: string | null
) {
  const progress = await t.query(api.nftsV2.getMintProgress, {
    articleId: ids.articleId,
  })
  const record = await t.query(api.nfts.getNFTByArticle, {
    articleId: ids.articleId,
  })
  const isArticleAuthor = userId === ids.authorId
  const eligibility = isArticleAuthor
    ? await as(userId!).action(api.nftsV2.getMintEligibility, {
        articleId: ids.articleId,
      })
    : null
  return deriveNftPanel({
    v2Enabled: true,
    progress,
    record: record as never,
    viewer: { signedIn: !!userId, isArticleAuthor, verifiedAddress },
    eligibility,
  })
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
    {
      ...roles,
      treasury: treasury.publicKey(),
      token,
      min_tip: MIN_TIP.toString(),
    }
  )
  nftId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_article_nft.wasm'), admin),
    admin,
    {
      ...roles,
      core: coreId,
      threshold_token: token,
      threshold: THRESHOLD.toString(),
      base_uri: 'http://localhost:3122/api/nft/',
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
      slug: 'nft-client-article',
      title: 'An article minted from the client',
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
  await t.action(internal.chain.config.refreshChainConfig, {})
}, 600_000)

describe('5.10 from the client: mint at the threshold, then transfer', () => {
  const mintExpectation = (): NftCallExpectation => ({
    action: 'mint',
    articleId: ids.articleId,
    networkPassphrase: LOCAL_PASSPHRASE,
    nftContractId: nftId,
    platformContracts: [coreId, token],
  })

  it('a mint one minimum tip below the threshold fails in simulation and can be retried', async () => {
    await tip(THRESHOLD - MIN_TIP)
    expect(await panelFor(ids.authorId, author.publicKey())).toMatchObject({
      kind: 'progress',
      progress: { remaining: MIN_TIP.toString(), reached: false, live: true },
      mint: { kind: 'below' },
    })
    // The server prepares it; the contract enforces the threshold.
    const prepared = local(
      await as(ids.authorId).mutation(api.nftsV2.prepareMint, {
        articleId: ids.articleId,
        requestId: 'client-mint-below',
      })
    )
    const result = await run(ids.authorId, prepared, mintExpectation(), author)
    expect(result).toMatchObject({
      status: 'simulation_failed',
      error: { code: 70, name: 'BelowThreshold', contract: 'nft' },
    })
    const status = (await as(ids.authorId).query(
      api.nftsV2.getNftSubmissionStatus,
      { submissionId: prepared.submissionId }
    ))!
    expect(status).toMatchObject({ status: 'FAILED', canRetry: true })
    expect(
      (
        await nft(author).token_of_article({
          article_id: hexToBytes(articleKey),
        })
      ).result
    ).toBeNull()
  })

  it('mints at exactly the threshold through prepare, sign, send, record and verification', async () => {
    // A minimum tip takes the total to exactly the threshold.
    await tip(MIN_TIP)
    expect(await panelFor(ids.authorId, author.publicKey())).toMatchObject({
      kind: 'progress',
      progress: { total: THRESHOLD.toString(), reached: true, live: true },
      mint: { kind: 'eligible' },
    })
    const prepared = local(
      await as(ids.authorId).mutation(api.nftsV2.prepareMint, {
        articleId: ids.articleId,
        requestId: 'client-mint-1',
      })
    )
    const result = await run(ids.authorId, prepared, mintExpectation(), author)
    expect(result.status).toBe('sent')
    const status = await follow(
      ids.authorId,
      prepared.submissionId,
      indexEvents
    )
    expect(status).toMatchObject({
      action: 'mint',
      status: 'CONFIRMED',
      indexed: true,
      nft: { ownerAddress: author.publicKey(), contractId: nftId },
    })
    const tokenId = status.nft!.tokenId
    expect((await nft(author).owner_of({ token_id: tokenId })).result).toBe(
      author.publicKey()
    )
    expect(await panelFor(ids.authorId, author.publicKey())).toMatchObject({
      kind: 'minted',
      viewerOwns: true,
      transfer: 'allowed',
      token: { tokenId, ownerAddress: author.publicKey(), contractId: nftId },
    })
  })

  it('transfers to a Quilltip user, confirming the address the server resolved', async () => {
    const before = await panelFor(ids.authorId, author.publicKey())
    if (before.kind !== 'minted') throw new Error('not minted')
    const recipient = checkRecipient('@collector', {
      owner: author.publicKey(),
      platformContracts: [nftId, coreId, token],
    })
    expect(recipient).toEqual({
      status: 'ok',
      recipient: { kind: 'user', username: 'collector' },
    })
    const prepared = local(
      await as(ids.authorId).mutation(api.nftsV2.prepareTransfer, {
        nftId: before.token.nftId! as Id<'articleNFTs'>,
        recipient: { kind: 'user', username: 'collector' },
        requestId: 'client-transfer-1',
      })
    )
    // The review step shows this address; the user confirms it.
    expect(prepared.args.to).toBe(collector.publicKey())
    const result = await run(
      ids.authorId,
      prepared,
      {
        action: 'transfer',
        nftId: before.token.nftId!,
        tokenId: before.token.tokenId,
        owner: author.publicKey(),
        recipient: prepared.args.to,
        networkPassphrase: LOCAL_PASSPHRASE,
        nftContractId: nftId,
        platformContracts: [coreId, token],
      },
      author
    )
    expect(result.status).toBe('sent')
    expect(
      await follow(ids.authorId, prepared.submissionId, indexEvents)
    ).toMatchObject({ status: 'CONFIRMED', indexed: true })
    expect(
      (await nft(author).owner_of({ token_id: before.token.tokenId })).result
    ).toBe(collector.publicKey())
    // The former owner loses the action; the new owner has it.
    expect(await panelFor(ids.authorId, author.publicKey())).toMatchObject({
      kind: 'minted',
      viewerOwns: false,
      transfer: 'not-owner',
      token: { ownerAddress: collector.publicKey() },
    })
    expect(
      await panelFor(ids.collectorId, collector.publicKey())
    ).toMatchObject({ viewerOwns: true, transfer: 'allowed' })
  })

  it('transfers to an address outside Quilltip typed by the owner', async () => {
    const before = await panelFor(ids.collectorId, collector.publicKey())
    if (before.kind !== 'minted') throw new Error('not minted')
    const typed = checkRecipient(outsider.publicKey().toLowerCase(), {
      owner: collector.publicKey(),
      platformContracts: [nftId, coreId, token],
    })
    if (typed.status !== 'ok' || typed.recipient.kind !== 'address') {
      throw new Error('recipient refused')
    }
    const prepared = local(
      await as(ids.collectorId).mutation(api.nftsV2.prepareTransfer, {
        nftId: before.token.nftId! as Id<'articleNFTs'>,
        recipient: { kind: 'address', address: typed.recipient.address },
        requestId: 'client-transfer-2',
      })
    )
    const result = await run(
      ids.collectorId,
      prepared,
      {
        action: 'transfer',
        nftId: before.token.nftId!,
        tokenId: before.token.tokenId,
        owner: collector.publicKey(),
        recipient: typed.recipient.address,
        networkPassphrase: LOCAL_PASSPHRASE,
        nftContractId: nftId,
        platformContracts: [coreId, token],
      },
      collector
    )
    expect(result.status).toBe('sent')
    expect(
      await follow(ids.collectorId, prepared.submissionId, indexEvents)
    ).toMatchObject({ status: 'CONFIRMED', indexed: true })
    expect(
      (await nft(outsider).owner_of({ token_id: before.token.tokenId })).result
    ).toBe(outsider.publicKey())
    // Nobody in Quilltip owns it now; readers see an outside wallet.
    expect(await panelFor(null, null)).toMatchObject({
      kind: 'minted',
      transfer: 'signed-out',
      token: { ownerAddress: outsider.publicKey(), ownerUsername: null },
    })
  })
})
