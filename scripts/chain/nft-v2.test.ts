/// <reference types="vite/client" />
/**
 * Payments v2 article NFT backend (#450): live mint eligibility, prepare
 * validation and idempotency, submission verification (rules (a) and (b)),
 * the NFT event handlers (replay, reordering, orphans, non-user owners), the
 * metadata query, and v1 rows.
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import {
  Address,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import { bytesToHex, hexToBytes } from '../../convex/lib/chain/ids'
import {
  arweaveIdFromHex,
  nftEventFacts,
  verifyNftTransaction,
} from '../../convex/lib/chain/nftEvents'
import { rpcEventId } from './coreEvents'
import {
  CORE,
  TOKEN,
  fakeRpcFetch,
  failedResponse,
  seedAddress,
  successResponse,
} from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const TESTNET = 'Test SDF Network ; September 2015'
const NFT = StrKey.encodeContract(new Uint8Array(32).fill(41))
const OTHER_NFT = StrKey.encodeContract(new Uint8Array(32).fill(42))
const AUTHOR = seedAddress(51)
const COLLECTOR = seedAddress(52)
const STRANGER = seedAddress(53)
const OTHER = seedAddress(54)
const ARTICLE_KEY = 'cd'.repeat(32)
const ORPHAN_KEY = 'ef'.repeat(32)
const HASH = 'a1'.repeat(32)
const HASH2 = 'b2'.repeat(32)
const EPOCH = 'testnet-nft'
const T0 = Date.UTC(2026, 11, 3, 12, 0, 0)
const T0S = Math.floor(T0 / 1000)
const LEDGER = 6_100_000

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    CORE_CONTRACT_ID: CORE,
    NFT_CONTRACT_ID: NFT,
    TOKEN_CONTRACT_ID: TOKEN,
    SITE_URL: 'https://example.test',
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type T = ReturnType<typeof convexTest>

async function seed(t: T) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const verified = (username: string, address: string) =>
      db.insert('users', {
        username,
        usernameLower: username,
        email: `${username}@example.test`,
        stellarAddress: address,
        stellarAddressVerifiedAt: now,
        stellarAddressVerifiedNetwork: TESTNET,
        createdAt: now,
        updatedAt: now,
      })
    const authorId = await verified('writer', AUTHOR)
    const collectorId = await verified('collector', COLLECTOR)
    const unverifiedId = await db.insert('users', {
      username: 'unverified',
      usernameLower: 'unverified',
      email: 'unverified@example.test',
      stellarAddress: OTHER,
      createdAt: now,
      updatedAt: now,
    })
    const nowalletId = await db.insert('users', {
      username: 'nowallet',
      usernameLower: 'nowallet',
      email: 'nowallet@example.test',
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await db.insert('articles', {
      slug: 'words',
      title: 'Words',
      excerpt: 'About words.',
      content: { type: 'doc', content: [] },
      published: true,
      authorId,
      authorUsername: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    const chainArticleId = await db.insert('chainArticles', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      articleId,
      articleKey: ARTICLE_KEY,
      authorAddress: AUTHOR,
      contentHash: '12'.repeat(32),
      arweaveId: '34'.repeat(32),
      contentVersion: 2,
      splits: [],
      totals: {},
      status: 'REGISTERED',
      updatedAt: now,
    })
    return {
      authorId,
      collectorId,
      unverifiedId,
      nowalletId,
      articleId,
      chainArticleId,
    }
  })
}
type Seeded = Awaited<ReturnType<typeof seed>>

const as = (t: T, userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as { data: { code: string } & Record<string, unknown> }).data
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function sym(s: string) {
  return nativeToScVal(s, { type: 'symbol' })
}
function addr(a: string) {
  return new Address(a).toScVal()
}
function map(entries: Array<[string, xdr.ScVal]>) {
  return xdr.ScVal.scvMap(
    entries.map(([k, val]) => new xdr.ScMapEntry({ key: sym(k), val }))
  )
}

type NftEventSpec =
  | {
      kind: 'minted'
      articleKey?: string
      author?: string
      tokenId?: number
      total?: bigint
    }
  | { kind: 'transfer'; from: string; to: string; tokenId?: number }

function eventParts(spec: NftEventSpec): {
  topics: xdr.ScVal[]
  data: xdr.ScVal
} {
  if (spec.kind === 'minted') {
    return {
      topics: [
        sym('article_nft_minted'),
        nativeToScVal(hexToBytes(spec.articleKey ?? ARTICLE_KEY)),
        addr(spec.author ?? AUTHOR),
      ],
      data: map([
        ['token_id', nativeToScVal(spec.tokenId ?? 0, { type: 'u32' })],
        [
          'total_at_mint',
          nativeToScVal(spec.total ?? BigInt(500_000_000), { type: 'i128' }),
        ],
      ]),
    }
  }
  return {
    topics: [sym('transfer'), addr(spec.from), addr(spec.to)],
    data: map([
      ['token_id', nativeToScVal(spec.tokenId ?? 0, { type: 'u32' })],
    ]),
  }
}

function rawEvent(
  spec: NftEventSpec,
  opts: {
    ledger?: number
    tx?: number
    index?: number
    txHash?: string
    closeTime?: number
    contractId?: string
  } = {}
): RawRpcEvent {
  const ledger = opts.ledger ?? LEDGER
  const { topics, data } = eventParts(spec)
  return {
    type: 'contract',
    ledger,
    ledgerClosedAt: new Date((opts.closeTime ?? T0S + 10) * 1000).toISOString(),
    contractId: opts.contractId ?? NFT,
    id: rpcEventId(ledger, opts.tx ?? 1, 0, opts.index ?? 0),
    txHash: opts.txHash ?? HASH,
    topic: topics.map((x) => x.toXDR('base64')),
    value: data.toXDR('base64'),
    inSuccessfulContractCall: true,
  }
}

function eventXdr(spec: NftEventSpec, contractId = NFT): string {
  const { topics, data } = eventParts(spec)
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new xdr.ContractId(StrKey.decodeContract(contractId)),
    type: xdr.ContractEventType['contract'],
    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data })),
  }).toXDR('base64')
}

async function ingest(t: T, events: RawRpcEvent[]) {
  return t.mutation(internal.chain.indexer.ingestBackfill, { events })
}

async function v2Rows(t: T) {
  return t.run(async ({ db }) =>
    (await db.query('articleNFTs').collect()).filter(
      (r) => r.contractVersion === 'v2'
    )
  )
}

async function transfers(t: T) {
  return t.run(async ({ db }) => db.query('nftTransfers').collect())
}

async function eventHandled(t: T, id: string) {
  return t.run(
    async ({ db }) =>
      (await db.query('chainEvents').collect()).find((e) => e.eventId === id)
        ?.handled
  )
}

// ---------------------------------------------------------------------------
// Live eligibility
// ---------------------------------------------------------------------------

type ChainState = {
  registered: boolean
  author: string
  total: bigint
  threshold: bigint
  tokenOf: number | null
  paused: boolean
  fail?: boolean
}

const BASE_STATE: ChainState = {
  registered: true,
  author: AUTHOR,
  total: BigInt(600_000_000),
  threshold: BigInt(500_000_000),
  tokenOf: null,
  paused: false,
}

function viewCall(params: Record<string, unknown> | undefined) {
  const tx = TransactionBuilder.fromXdr(
    String(params?.transaction),
    TESTNET
  ) as Transaction
  const call = (
    tx.operations[0] as unknown as {
      func: {
        invokeContract: {
          contractAddress: xdr.ScAddress
          functionName: { toString(): string }
          args: xdr.ScVal[]
        }
      }
    }
  ).func.invokeContract
  return {
    contract: Address.fromScAddress(call.contractAddress).toString(),
    method: call.functionName.toString(),
    args: call.args.map((a) => scValToNative(a) as unknown),
  }
}

/** Answers the Core and NFT views `getMintEligibility` reads. */
function stubChain(state: Partial<ChainState> = {}) {
  const s = { ...BASE_STATE, ...state }
  const fetch = fakeRpcFetch((method, params) => {
    if (method !== 'simulateTransaction') throw new Error(method)
    if (s.fail) return { latestLedger: 1, error: 'HostError: boom' }
    const { contract, method: view, args } = viewCall(params)
    let value: xdr.ScVal
    if (contract === CORE && view === 'get_article') {
      expect(bytesToHex(args[0] as Uint8Array)).toBe(ARTICLE_KEY)
      value = s.registered
        ? map([['author', addr(s.author)]])
        : xdr.ScVal.scvVoid()
    } else if (contract === CORE && view === 'article_total') {
      expect(args[1]).toBe(TOKEN)
      value = nativeToScVal(s.total, { type: 'i128' })
    } else if (contract === NFT && view === 'threshold') {
      value = xdr.ScVal.scvVec([
        addr(TOKEN),
        nativeToScVal(s.threshold, { type: 'i128' }),
      ])
    } else if (contract === NFT && view === 'token_of_article') {
      value =
        s.tokenOf === null
          ? xdr.ScVal.scvVoid()
          : nativeToScVal(s.tokenOf, { type: 'u32' })
    } else if (contract === NFT && view === 'paused') {
      value = xdr.ScVal.scvBool(s.paused)
    } else {
      throw new Error(`unexpected view ${contract} ${view}`)
    }
    return { latestLedger: 1, results: [{ xdr: value.toXDR('base64') }] }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function eligibility(
  t: T,
  s: Seeded,
  userId: Id<'users'> | null = s.authorId
) {
  const runner = userId ? as(t, userId) : t
  return runner.action(api.nftsV2.getMintEligibility, {
    articleId: s.articleId,
  })
}

describe('getMintEligibility', () => {
  it('is ELIGIBLE for the on-chain author at the threshold, with base-unit amounts', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain({ total: BigInt(500_000_000) })
    expect(await eligibility(t, s)).toMatchObject({
      state: 'ELIGIBLE',
      network: 'TESTNET',
      articleKey: ARTICLE_KEY,
      nftContractId: NFT,
      thresholdToken: TOKEN,
      threshold: '500000000',
      total: '500000000',
      remaining: '0',
      onChainAuthor: AUTHOR,
      callerAddress: AUTHOR,
      paused: false,
      tokenId: null,
    })
  })

  it('reports BELOW_THRESHOLD with the remaining amount', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain({ total: BigInt(499_999_999) })
    expect(await eligibility(t, s)).toMatchObject({
      state: 'BELOW_THRESHOLD',
      total: '499999999',
      remaining: '1',
    })
  })

  it('reports MINTED from token_of_article, before the wallet checks', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain({ tokenOf: 7 })
    await t.run(({ db }) =>
      db.patch(s.authorId, { stellarAddressVerifiedAt: undefined })
    )
    expect(await eligibility(t, s)).toMatchObject({
      state: 'MINTED',
      tokenId: 7,
    })
  })

  it('reports PAUSED, NOT_REGISTERED and UNAVAILABLE from live reads', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain({ paused: true })
    expect((await eligibility(t, s)).state).toBe('PAUSED')
    stubChain({ registered: false })
    expect((await eligibility(t, s)).state).toBe('NOT_REGISTERED')
    stubChain({ fail: true })
    expect((await eligibility(t, s)).state).toBe('UNAVAILABLE')
  })

  it('reports NOT_REGISTERED without a registration row, and NOT_FOUND for an unpublished article', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain()
    await t.run(({ db }) => db.delete(s.chainArticleId))
    expect((await eligibility(t, s)).state).toBe('NOT_REGISTERED')
    await t.run(({ db }) => db.patch(s.articleId, { published: false }))
    expect((await eligibility(t, s, s.collectorId)).state).toBe('NOT_FOUND')
    expect((await eligibility(t, s)).state).toBe('NOT_PUBLISHED')
  })

  it('answers signed-out callers and non-authors without RPC reads', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const fetch = stubChain()
    expect((await eligibility(t, s, null)).state).toBe('SIGNED_OUT')
    expect((await eligibility(t, s, s.collectorId)).state).toBe('NOT_AUTHOR')
    expect((await eligibility(t, s, s.unverifiedId)).state).toBe('NOT_AUTHOR')
    expect(fetch.calls).toHaveLength(0)
    // No shared limit: signed-out calls are never rate limited.
    for (let i = 0; i < 150; i++) {
      expect((await eligibility(t, s, null)).state).toBe('SIGNED_OUT')
    }
    expect(fetch.calls).toHaveLength(0)
    // An author's reads are unaffected by them.
    expect((await eligibility(t, s)).state).toBe('ELIGIBLE')
    expect(fetch.calls.length).toBeGreaterThan(0)
  })

  it('reads live for a user whose verified address is the indexed author', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(({ db }) =>
      db.patch(s.chainArticleId, { authorAddress: COLLECTOR })
    )
    stubChain({ author: COLLECTOR })
    expect(await eligibility(t, s, s.collectorId)).toMatchObject({
      state: 'ELIGIBLE',
      onChainAuthor: COLLECTOR,
      callerAddress: COLLECTOR,
    })
    // The live author decides when the indexed one is stale.
    const fetch = stubChain({ author: AUTHOR })
    expect((await eligibility(t, s, s.collectorId)).state).toBe('NOT_AUTHOR')
    expect(fetch.calls.length).toBeGreaterThan(0)
  })

  it('separates the author wallet states', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain()

    await t.run(({ db }) =>
      db.patch(s.authorId, {
        stellarAddress: undefined,
        stellarAddressVerifiedAt: undefined,
      })
    )
    expect((await eligibility(t, s)).state).toBe('NO_WALLET')
    await t.run(({ db }) => db.patch(s.authorId, { stellarAddress: AUTHOR }))
    expect((await eligibility(t, s)).state).toBe('WALLET_NOT_VERIFIED')
    await t.run(({ db }) =>
      db.patch(s.authorId, {
        stellarAddress: STRANGER,
        stellarAddressVerifiedAt: Date.now(),
      })
    )
    expect(await eligibility(t, s)).toMatchObject({
      state: 'AUTHOR_ADDRESS_MISMATCH',
      onChainAuthor: AUTHOR,
      callerAddress: STRANGER,
    })
  })

  it('reports PENDING while a mint can still land', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain()
    const prepared = await as(t, s.authorId).mutation(api.nftsV2.prepareMint, {
      articleId: s.articleId,
      requestId: 'mint-1',
    })
    expect(await eligibility(t, s)).toMatchObject({
      state: 'PENDING',
      openSubmissionId: prepared.submissionId,
    })
    // A prepared call past its time bound can no longer land.
    vi.setSystemTime(T0 + 301_000)
    expect((await eligibility(t, s)).state).toBe('ELIGIBLE')
  })

  it('is DISABLED without CHAIN_V2_ENABLED or an NFT contract, and rate limited', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubChain()
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect((await eligibility(t, s)).state).toBe('DISABLED')
    vi.stubEnv('CHAIN_V2_ENABLED', 'true')
    vi.stubEnv('NFT_CONTRACT_ID', '')
    expect((await eligibility(t, s)).state).toBe('DISABLED')
    vi.stubEnv('NFT_CONTRACT_ID', NFT)
    for (let i = 0; i < 30; i++) await eligibility(t, s)
    const limited = await eligibility(t, s)
    expect(limited.state).toBe('RATE_LIMITED')
    expect(limited.retryAfterMs).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

const mint = (t: T, s: Seeded, requestId = 'mint-1', userId = s.authorId) =>
  as(t, userId).mutation(api.nftsV2.prepareMint, {
    articleId: s.articleId,
    requestId,
  })

/** Mints token 0 to AUTHOR through the indexer. */
async function indexMint(t: T, extra: Parameters<typeof rawEvent>[1] = {}) {
  await ingest(t, [rawEvent({ kind: 'minted' }, extra)])
  const [row] = await v2Rows(t)
  return row!
}

describe('prepareMint', () => {
  it('returns what the client needs to build Nft.mint, idempotent per requestId', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await mint(t, s)
    expect(first).toEqual({
      submissionId: first.submissionId,
      existing: false,
      network: 'TESTNET',
      networkPassphrase: TESTNET,
      contractId: NFT,
      maxTime: T0S + 300,
      signer: AUTHOR,
      action: 'mint',
      method: 'mint',
      args: { article_id: ARTICLE_KEY },
      articleId: s.articleId,
      articleKey: ARTICLE_KEY,
    })
    const again = await mint(t, s)
    expect(again).toEqual({ ...first, existing: true })
    const sub = await t.run(({ db }) => db.get(first.submissionId))
    expect(sub).toMatchObject({
      kind: 'nft',
      status: 'PREPARED',
      contractId: NFT,
      clientRefs: [],
      related: [],
      nftKey: `${NFT}:mint:${ARTICLE_KEY}`,
      expectedNft: { action: 'mint', articleKey: ARTICLE_KEY, signer: AUTHOR },
    })
  })

  it('refuses a second prepare while the first can land, then allows it after maxTime', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await mint(t, s)
    expect(await errorOf(mint(t, s, 'mint-2'))).toMatchObject({
      code: 'PENDING',
      submissionId: first.submissionId,
    })
    vi.setSystemTime(T0 + 301_000)
    expect((await mint(t, s, 'mint-2')).existing).toBe(false)
  })

  it('validates the gate, the caller, the wallet, the registration and the article', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect((await errorOf(mint(t, s))).code).toBe('CHAIN_V2_DISABLED')
    vi.stubEnv('CHAIN_V2_ENABLED', 'true')
    vi.stubEnv('NFT_CONTRACT_ID', '')
    expect((await errorOf(mint(t, s))).code).toBe('CHAIN_CONFIG_MISSING')
    vi.stubEnv('NFT_CONTRACT_ID', NFT)
    expect(
      (
        await errorOf(
          t.mutation(api.nftsV2.prepareMint, {
            articleId: s.articleId,
            requestId: 'x',
          })
        )
      ).code
    ).toBe('UNAUTHENTICATED')
    expect((await errorOf(mint(t, s, 'a', s.nowalletId))).code).toBe(
      'NO_WALLET'
    )
    expect((await errorOf(mint(t, s, 'b', s.unverifiedId))).code).toBe(
      'WALLET_NOT_VERIFIED'
    )
    expect(await errorOf(mint(t, s, 'c', s.collectorId))).toMatchObject({
      code: 'NOT_ONCHAIN_AUTHOR',
      onChainAuthor: AUTHOR,
    })
    expect((await errorOf(mint(t, s, 'bad id!'))).code).toBe('INVALID_PREPARE')
    await t.run(({ db }) => db.patch(s.chainArticleId, { status: 'SUBMITTED' }))
    expect((await errorOf(mint(t, s, 'd'))).code).toBe('NOT_REGISTERED')
    await t.run(({ db }) => db.patch(s.articleId, { published: false }))
    expect((await errorOf(mint(t, s, 'e'))).code).toBe('NOT_PUBLISHED')
  })

  it('refuses a requestId used for another request', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await mint(t, s, 'shared')
    const row = await indexMint(t)
    expect(
      (
        await errorOf(
          as(t, s.authorId).mutation(api.nftsV2.prepareTransfer, {
            nftId: row._id,
            recipient: { kind: 'address', address: COLLECTOR },
            requestId: 'shared',
          })
        )
      ).code
    ).toBe('INVALID_PREPARE')
    expect((await errorOf(mint(t, s, 'shared', s.collectorId))).code).toBe(
      'INVALID_PREPARE'
    )
  })

  it('refuses once the NFT is indexed, and rate limits prepares', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    expect(await errorOf(mint(t, s, 'after'))).toMatchObject({
      code: 'ALREADY_MINTED',
      nftId: row._id,
      tokenId: 0,
    })
    for (let i = 0; i < 10; i++) {
      await as(t, s.authorId).mutation(api.nftsV2.prepareTransfer, {
        nftId: row._id,
        recipient: { kind: 'address', address: COLLECTOR },
        requestId: `limit-${i}`,
      })
      // Fail the open transfer so the next prepare is not PENDING.
      await t.run(async ({ db }) => {
        for (const sub of await db.query('chainSubmissions').collect()) {
          await db.patch(sub._id, { status: 'FAILED' })
        }
      })
    }
    expect(
      await errorOf(
        as(t, s.authorId).mutation(api.nftsV2.prepareTransfer, {
          nftId: row._id,
          recipient: { kind: 'address', address: COLLECTOR },
          requestId: 'limit-x',
        })
      )
    ).toMatchObject({ code: 'RATE_LIMITED' })
  })
})

const transfer = (
  t: T,
  s: Seeded,
  nftId: Id<'articleNFTs'>,
  recipient:
    | { kind: 'address'; address: string }
    | { kind: 'user'; username: string },
  requestId = 'tx-1',
  userId = s.authorId
) =>
  as(t, userId).mutation(api.nftsV2.prepareTransfer, {
    nftId,
    recipient,
    requestId,
  })

describe('prepareTransfer', () => {
  it('returns what the client needs to build Nft.transfer to an address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    const prepared = await transfer(t, s, row._id, {
      kind: 'address',
      address: STRANGER,
    })
    expect(prepared).toEqual({
      submissionId: prepared.submissionId,
      existing: false,
      network: 'TESTNET',
      networkPassphrase: TESTNET,
      contractId: NFT,
      maxTime: T0S + 300,
      signer: AUTHOR,
      action: 'transfer',
      method: 'transfer',
      args: { from: AUTHOR, to: STRANGER, token_id: 0 },
      nftId: row._id,
      tokenId: 0,
      recipient: { address: STRANGER, userId: null, username: null },
    })
    expect(
      await transfer(t, s, row._id, { kind: 'address', address: STRANGER })
    ).toEqual({ ...prepared, existing: true })
    expect(
      await errorOf(
        transfer(t, s, row._id, { kind: 'address', address: COLLECTOR }, 'tx-2')
      )
    ).toMatchObject({ code: 'PENDING', submissionId: prepared.submissionId })
  })

  it('resolves a QuillTip user to their verified address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    const prepared = await transfer(t, s, row._id, {
      kind: 'user',
      username: '@Collector',
    })
    expect(prepared.args.to).toBe(COLLECTOR)
    expect(prepared.recipient).toEqual({
      address: COLLECTOR,
      userId: s.collectorId,
      username: 'collector',
    })
  })

  it('validates the recipient, the owner and the row version', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    const code = async (p: Promise<unknown>) => (await errorOf(p)).code
    expect(
      await code(transfer(t, s, row._id, { kind: 'address', address: 'GABC' }))
    ).toBe('INVALID_RECIPIENT')
    expect(
      await code(
        transfer(t, s, row._id, { kind: 'address', address: AUTHOR }, 'a')
      )
    ).toBe('SELF_TRANSFER')
    expect(
      await code(transfer(t, s, row._id, { kind: 'user', username: 'nobody' }))
    ).toBe('RECIPIENT_NOT_FOUND')
    expect(
      await code(
        transfer(t, s, row._id, { kind: 'user', username: 'unverified' })
      )
    ).toBe('RECIPIENT_NO_WALLET')
    expect(
      await code(
        transfer(
          t,
          s,
          row._id,
          { kind: 'address', address: STRANGER },
          'b',
          s.collectorId
        )
      )
    ).toBe('NOT_OWNER')
    const v1 = await t.run(({ db }) =>
      db.insert('articleNFTs', {
        articleId: s.articleId,
        tokenId: 'QUILL-v1',
        metadataUrl: 'https://arweave.net/x',
        mintedBy: s.authorId,
        currentOwner: s.authorId,
        tipThreshold: 1000,
        totalTipsAtMint: 1500,
        mintedAt: T0,
        updatedAt: T0,
      })
    )
    expect(
      await code(transfer(t, s, v1, { kind: 'address', address: STRANGER }))
    ).toBe('NOT_V2_NFT')
  })
})

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

describe('NFT event handlers', () => {
  it('create the v2 row from article_nft_minted; a replay changes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const event = rawEvent({ kind: 'minted', total: BigInt(530_000_000) })
    await ingest(t, [event])
    await ingest(t, [event])
    const rows = await v2Rows(t)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      articleId: s.articleId,
      tokenId: '0',
      contractAddress: NFT,
      metadataUrl: 'https://example.test/api/nft/0',
      mintedBy: s.authorId,
      currentOwner: s.authorId,
      ownerAddress: AUTHOR,
      minterAddress: AUTHOR,
      contractVersion: 'v2',
      txHash: HASH,
      chainEpoch: EPOCH,
      network: 'TESTNET',
      chainArticleKey: ARTICLE_KEY,
      totalAtMintBaseUnits: '530000000',
      mintEventId: event.id,
      ownerEventId: event.id,
      mintedAt: (T0S + 10) * 1000,
    })
    expect(rows[0]!.tipThreshold).toBeUndefined()
    const article = await t.run(({ db }) => db.get(s.articleId))
    expect(article).toMatchObject({ hasNft: true, nftId: rows[0]!._id })
    expect(await eventHandled(t, event.id)).toBe('done')
  })

  it('move ownership on transfer to an address outside QuillTip', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const minted = rawEvent({ kind: 'minted' })
    const moved = rawEvent(
      { kind: 'transfer', from: AUTHOR, to: STRANGER },
      { ledger: LEDGER + 2, txHash: HASH2 }
    )
    await ingest(t, [minted, moved])
    await ingest(t, [moved])
    const [row] = await v2Rows(t)
    expect(row).toMatchObject({
      ownerAddress: STRANGER,
      ownerEventId: moved.id,
    })
    expect(row!.currentOwner).toBeUndefined()
    const history = await transfers(t)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      nftId: row!._id,
      fromAddress: AUTHOR,
      toAddress: STRANGER,
      transactionId: HASH2,
      contractVersion: 'v2',
      chainEventId: moved.id,
      ledger: LEDGER + 2,
    })
    expect(history[0]!.toUserId).toBeUndefined()
    expect(await eventHandled(t, moved.id)).toBe('done')
  })

  it('keep the newest owner when transfers arrive out of order', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = rawEvent(
      { kind: 'transfer', from: AUTHOR, to: COLLECTOR },
      { ledger: LEDGER + 2, txHash: HASH2 }
    )
    const second = rawEvent(
      { kind: 'transfer', from: COLLECTOR, to: STRANGER },
      { ledger: LEDGER + 3, txHash: 'c3'.repeat(32) }
    )
    await ingest(t, [rawEvent({ kind: 'minted' })])
    await ingest(t, [second])
    await ingest(t, [first])
    const [row] = await v2Rows(t)
    expect(row).toMatchObject({
      ownerAddress: STRANGER,
      ownerEventId: second.id,
    })
    const history = await transfers(t)
    expect(history.map((h) => h.toAddress).sort()).toEqual(
      [COLLECTOR, STRANGER].sort()
    )
    expect(history.find((h) => h.toAddress === COLLECTOR)!.toUserId).toBe(
      s.collectorId
    )
  })

  it('hold a transfer that arrives before its mint and apply it with the mint', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const moved = rawEvent(
      { kind: 'transfer', from: AUTHOR, to: COLLECTOR },
      { ledger: LEDGER + 2, txHash: HASH2 }
    )
    await ingest(t, [moved])
    expect(await eventHandled(t, moved.id)).toBe('pending')
    expect(await v2Rows(t)).toHaveLength(0)
    await ingest(t, [rawEvent({ kind: 'minted' })])
    const [row] = await v2Rows(t)
    expect(row).toMatchObject({
      ownerAddress: COLLECTOR,
      currentOwner: s.collectorId,
      ownerEventId: moved.id,
    })
    expect(await eventHandled(t, moved.id)).toBe('done')
    expect(await transfers(t)).toHaveLength(1)
  })

  it('mark a mint of an article outside QuillTip, and its transfers, as orphans', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const minted = rawEvent({
      kind: 'minted',
      articleKey: ORPHAN_KEY,
      tokenId: 3,
    })
    const moved = rawEvent(
      { kind: 'transfer', from: AUTHOR, to: STRANGER, tokenId: 3 },
      { ledger: LEDGER + 2 }
    )
    await ingest(t, [minted, moved])
    expect(await eventHandled(t, minted.id)).toBe('orphan')
    expect(await eventHandled(t, moved.id)).toBe('orphan')
    expect(await v2Rows(t)).toHaveLength(0)
    expect(await transfers(t)).toHaveLength(0)
  })

  it('ignore events of another contract and flag malformed events', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const foreign = rawEvent({ kind: 'minted' }, { contractId: OTHER_NFT })
    const bad = rawEvent({ kind: 'minted' }, { index: 1 })
    bad.value = map([['token_id', nativeToScVal('x')]]).toXDR('base64')
    const result = await ingest(t, [foreign, bad])
    expect(result.skipped).toBe(1)
    expect(await eventHandled(t, bad.id)).toBe('error')
    expect(await v2Rows(t)).toHaveLength(0)
  })

  it('keep the OpenZeppelin mint and royalty events as done', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const ozMint: RawRpcEvent = {
      ...rawEvent({ kind: 'minted' }, { index: 0 }),
      topic: [sym('mint').toXDR('base64'), addr(AUTHOR).toXDR('base64')],
      value: map([['token_id', nativeToScVal(0, { type: 'u32' })]]).toXDR(
        'base64'
      ),
    }
    await ingest(t, [ozMint, rawEvent({ kind: 'minted' }, { index: 2 })])
    expect(await eventHandled(t, ozMint.id)).toBe('done')
    expect(await v2Rows(t)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Verification and status
// ---------------------------------------------------------------------------

function stubTransaction(response: (hash: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    fakeRpcFetch((method, params) => {
      if (method !== 'getTransaction') throw new Error(method)
      return response(String(params?.hash))
    })
  )
}

async function submit(
  t: T,
  userId: Id<'users'>,
  submissionId: Id<'chainSubmissions'>,
  hash = HASH
) {
  await as(t, userId).mutation(api.chain.submissions.recordSubmitted, {
    submissionId,
    txHash: hash,
  })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
}

const status = (t: T, userId: Id<'users'>, id: Id<'chainSubmissions'>) =>
  as(t, userId).query(api.nftsV2.getNftSubmissionStatus, { submissionId: id })

describe('mint and transfer verification', () => {
  it('confirm a mint from the RPC events (rule (a)); ownership waits for the indexer', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    stubTransaction((hash) =>
      successResponse(hash, [[eventXdr({ kind: 'minted' })]], LEDGER)
    )
    await submit(t, s.authorId, prepared.submissionId)
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      action: 'mint',
      status: 'CONFIRMED',
      txHash: HASH,
      canRetry: false,
      indexed: false,
      nft: null,
    })
    expect(await v2Rows(t)).toHaveLength(0)
    await indexMint(t)
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      indexed: true,
      nft: { tokenId: 0, ownerAddress: AUTHOR, contractId: NFT },
    })
  })

  it('mark a successful transaction without the event MISMATCH, never FAILED', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    stubTransaction((hash) =>
      successResponse(hash, [[eventXdr({ kind: 'minted' }, OTHER_NFT)]], LEDGER)
    )
    await submit(t, s.authorId, prepared.submissionId)
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'no_event',
      needsReview: true,
      canRetry: false,
    })
  })

  it('mark an RPC FAILED transaction FAILED with a retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    stubTransaction((hash) => failedResponse(hash, LEDGER))
    await submit(t, s.authorId, prepared.submissionId)
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      status: 'FAILED',
      canRetry: true,
    })
  })

  it('confirm a transfer, and flag a transfer to a different address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    const good = await transfer(t, s, row._id, {
      kind: 'user',
      username: 'collector',
    })
    stubTransaction((hash) =>
      successResponse(
        hash,
        [[eventXdr({ kind: 'transfer', from: AUTHOR, to: COLLECTOR })]],
        LEDGER + 2
      )
    )
    await submit(t, s.authorId, good.submissionId, HASH2)
    expect(await status(t, s.authorId, good.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      indexed: false,
    })
    // Ownership has not moved: only the indexed event moves it.
    expect((await v2Rows(t))[0]!.ownerAddress).toBe(AUTHOR)
    await ingest(t, [
      rawEvent(
        { kind: 'transfer', from: AUTHOR, to: COLLECTOR },
        { ledger: LEDGER + 2, txHash: HASH2 }
      ),
    ])
    expect(await status(t, s.authorId, good.submissionId)).toMatchObject({
      indexed: true,
      nft: { ownerAddress: COLLECTOR },
    })

    const bad = await transfer(
      t,
      s,
      row._id,
      { kind: 'address', address: STRANGER },
      'tx-2',
      s.collectorId
    )
    stubTransaction((hash) =>
      successResponse(
        hash,
        [[eventXdr({ kind: 'transfer', from: COLLECTOR, to: OTHER })]],
        LEDGER + 3
      )
    )
    await submit(t, s.collectorId, bad.submissionId, 'c3'.repeat(32))
    expect(await status(t, s.collectorId, bad.submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:to',
      needsReview: true,
    })
  })

  it('confirm a submission from the indexed event alone (rule (b))', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    await indexMint(t)
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      txHash: HASH,
      indexed: true,
    })
  })

  it('do not confirm from an event that closed after the time bound', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    await indexMint(t, { closeTime: T0S + 301 })
    expect((await status(t, s.authorId, prepared.submissionId))!.status).toBe(
      'PREPARED'
    )
  })

  it('flag an event whose hash differs from the recorded one', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    stubTransaction((hash) => ({
      ...successResponse(hash, [[]], LEDGER),
      status: 'NOT_FOUND',
    }))
    await as(t, s.authorId).mutation(api.chain.submissions.recordSubmitted, {
      submissionId: prepared.submissionId,
      txHash: HASH2,
    })
    await indexMint(t)
    const sub = await t.run(({ db }) => db.get(prepared.submissionId))
    expect(sub).toMatchObject({
      status: 'SUBMITTED',
      needsReview: true,
      lastError: 'event_hash_differs',
    })
  })

  it('resolve from indexed state in the recheck path', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    // The event was indexed while the submission was not open to it.
    await t.run(({ db }) =>
      db.patch(prepared.submissionId, { nftKey: 'detached' })
    )
    await indexMint(t)
    expect(
      await t.mutation(internal.chain.submissions.resolveUnfound, {
        submissionId: prepared.submissionId,
      })
    ).toBe('linked')
    expect(await status(t, s.authorId, prepared.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      txHash: HASH,
    })
  })

  it('hide another user’s submission', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await mint(t, s)
    expect(await status(t, s.collectorId, prepared.submissionId)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Metadata and v1 rows
// ---------------------------------------------------------------------------

describe('getTokenMetadata', () => {
  it('returns the Core anchor and article for an indexed token, null otherwise', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId: 0 })
    ).toBeNull()
    await indexMint(t)
    expect(await t.query(api.nftsV2.getTokenMetadata, { tokenId: 0 })).toEqual({
      tokenId: 0,
      network: 'TESTNET',
      contractId: NFT,
      available: true,
      title: 'Words',
      excerpt: 'About words.',
      authorUsername: 'writer',
      slug: 'words',
      contentHash: '12'.repeat(32),
      contentVersion: 2,
      arweaveId: arweaveIdFromHex('34'.repeat(32)),
      minterAddress: AUTHOR,
      mintedAt: (T0S + 10) * 1000,
    })
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId: 1 })
    ).toBeNull()
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId: -1 })
    ).toBeNull()
    await t.run(({ db }) => db.patch(s.articleId, { published: false }))
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId: 0 })
    ).toMatchObject({ available: false, title: null, slug: null })
    vi.stubEnv('NFT_CONTRACT_ID', OTHER_NFT)
    expect(
      await t.query(api.nftsV2.getTokenMetadata, { tokenId: 0 })
    ).toBeNull()
  })
})

describe('v1 rows', () => {
  async function seedV1(t: T, s: Seeded) {
    return t.run(async ({ db }) => {
      const nftId = await db.insert('articleNFTs', {
        articleId: s.articleId,
        tokenId: 'QUILL-v1',
        contractAddress: '',
        metadataUrl: 'https://arweave.net/abc',
        mintedBy: s.authorId,
        currentOwner: s.collectorId,
        tipThreshold: 1000,
        totalTipsAtMint: 1500,
        mintedAt: T0 - 1000,
        updatedAt: T0 - 1000,
      })
      const transferId = await db.insert('nftTransfers', {
        nftId,
        fromUserId: s.authorId,
        toUserId: s.collectorId,
        transactionId: `pending_transfer_${nftId}`,
        transferredAt: T0 - 500,
      })
      return { nftId, transferId }
    })
  }

  it('stay unchanged by v2 events and show as v1 records next to v2 rows', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const v1 = await seedV1(t, s)
    const before = await t.run(async ({ db }) => ({
      nft: await db.get(v1.nftId),
      transfer: await db.get(v1.transferId),
    }))
    await ingest(t, [
      rawEvent({ kind: 'minted' }),
      rawEvent(
        { kind: 'transfer', from: AUTHOR, to: COLLECTOR },
        { ledger: LEDGER + 2, txHash: HASH2 }
      ),
    ])
    const after = await t.run(async ({ db }) => ({
      nft: await db.get(v1.nftId),
      transfer: await db.get(v1.transferId),
    }))
    expect(after).toEqual(before)

    const byArticle = await t.query(api.nfts.getNFTByArticle, {
      articleId: s.articleId,
    })
    expect(byArticle).toMatchObject({
      isMinted: true,
      contractVersion: 'v2',
      recordLabel: null,
      tokenId: '0',
      owner: COLLECTOR,
      ownerInfo: { username: 'collector' },
    })

    const owned = await t.query(api.nfts.getNFTsByOwner, {
      ownerId: s.collectorId,
    })
    expect(
      owned.map((n) => [n.tokenId, n.contractVersion, n.recordLabel]).sort()
    ).toEqual([
      ['0', 'v2', null],
      ['QUILL-v1', 'v1', 'v1 record'],
    ])
    expect(
      await t.query(api.nfts.getNFTsByOwner, { ownerId: s.authorId })
    ).toHaveLength(0)

    const details = await t.query(api.nfts.getNFTDetails, {
      nftId: (await v2Rows(t))[0]!._id,
    })
    expect(details).toMatchObject({
      contractVersion: 'v2',
      owner: { username: 'collector' },
      transferHistory: [
        { fromAddress: AUTHOR, toAddress: COLLECTOR, transactionId: HASH2 },
      ],
    })
  })

  it('keep a v1 record labelled when no v2 NFT exists', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await seedV1(t, s)
    expect(
      await t.query(api.nfts.getNFTByArticle, { articleId: s.articleId })
    ).toMatchObject({
      isMinted: true,
      contractVersion: 'v1',
      recordLabel: 'v1 record',
      tokenId: 'QUILL-v1',
    })
  })

  it('cannot move a v2 row through the v1 transfer mutation', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const row = await indexMint(t)
    await expect(
      as(t, s.authorId).mutation(api.nfts.transferNFT, {
        nftId: row._id,
        toUsername: 'collector',
      })
    ).rejects.toThrow('Transfer this NFT with your wallet on Stellar.')
    expect((await v2Rows(t))[0]!.ownerAddress).toBe(AUTHOR)
  })
})

describe('nftEvents', () => {
  it('parse the stored events and verify by contract and token', () => {
    expect(
      nftEventFacts({
        name: 'transfer',
        topics: ['transfer', AUTHOR, COLLECTOR],
        data: { token_id: 4 },
      })
    ).toEqual({ name: 'transfer', from: AUTHOR, to: COLLECTOR, tokenId: 4 })
    expect(nftEventFacts({ name: 'mint', topics: [], data: null })).toBeNull()
    const two = verifyNftTransaction({
      expected: { action: 'transfer', tokenId: 0, from: AUTHOR, to: COLLECTOR },
      nftContractId: NFT,
      contractEventsXdr: [
        [
          eventXdr({
            kind: 'transfer',
            from: AUTHOR,
            to: COLLECTOR,
            tokenId: 1,
          }),
          eventXdr({ kind: 'transfer', from: AUTHOR, to: COLLECTOR }),
        ],
      ],
      ledger: LEDGER,
    })
    expect(two.status).toBe('CONFIRMED')
    expect(
      verifyNftTransaction({
        expected: { action: 'mint', articleKey: ARTICLE_KEY, signer: OTHER },
        nftContractId: NFT,
        contractEventsXdr: [[eventXdr({ kind: 'minted' })]],
        ledger: LEDGER,
      })
    ).toMatchObject({ status: 'MISMATCH', mismatchReason: 'author' })
    expect(
      verifyNftTransaction({
        expected: { action: 'mint', articleKey: ARTICLE_KEY, signer: AUTHOR },
        nftContractId: NFT,
        contractEventsXdr: [[eventXdr({ kind: 'minted' })]],
        ledger: LEDGER,
        createdLedger: LEDGER + 1,
      })
    ).toMatchObject({ status: 'MISMATCH', mismatchReason: 'field:ledger' })
    expect(arweaveIdFromHex('00'.repeat(32))).toBe('A'.repeat(43))
  })
})

// ---------------------------------------------------------------------------
// Reader progress (indexed data)
// ---------------------------------------------------------------------------

async function seedConfig(
  t: T,
  extra: Partial<{
    nftContractId: string
    chainEpoch: string
    nftThreshold: string
    nftThresholdToken: string
    paused: { nft?: boolean }
  }> = {}
) {
  return t.run(({ db }) =>
    db.insert('chainConfig', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      coreContractId: CORE,
      nftContractId: NFT,
      tokenContractId: TOKEN,
      nftThreshold: '500000000',
      nftThresholdToken: TOKEN,
      paused: { nft: false },
      refreshedAt: T0 - 60_000,
      ...extra,
    })
  )
}

function thresholdSetEvent(
  threshold: bigint,
  opts: { ledger?: number; contractId?: string; token?: string } = {}
): RawRpcEvent {
  const ledger = opts.ledger ?? LEDGER
  return {
    type: 'contract',
    ledger,
    ledgerClosedAt: new Date((T0S + 10) * 1000).toISOString(),
    contractId: opts.contractId ?? NFT,
    id: rpcEventId(ledger, 1, 0, 0),
    txHash: HASH,
    topic: [sym('threshold_set').toXDR('base64')],
    value: map([
      ['threshold', nativeToScVal(threshold, { type: 'i128' })],
      ['token', addr(opts.token ?? TOKEN)],
    ]).toXDR('base64'),
    inSuccessfulContractCall: true,
  }
}

const progress = (t: T, s: Seeded, userId: Id<'users'> | null = null) =>
  (userId ? as(t, userId) : t).query(api.nftsV2.getMintProgress, {
    articleId: s.articleId,
  })

describe('getMintProgress', () => {
  it('serves threshold progress from indexed totals and the cached threshold, without RPC', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const fetch = stubChain()
    await seedConfig(t)
    await t.run(({ db }) =>
      db.patch(s.chainArticleId, { totals: { [TOKEN]: '120000000' } })
    )
    expect(await progress(t, s)).toEqual({
      state: 'NOT_MINTED',
      network: 'TESTNET',
      articleId: s.articleId,
      nftContractId: NFT,
      thresholdToken: TOKEN,
      threshold: '500000000',
      total: '120000000',
      remaining: '380000000',
      reached: false,
      paused: false,
      tokenId: null,
      nftId: null,
      ownerAddress: null,
      configRefreshedAt: T0 - 60_000,
      chainArticleUpdatedAt: T0,
    })
    await t.run(({ db }) =>
      db.patch(s.chainArticleId, { totals: { [TOKEN]: '500000000' } })
    )
    expect(await progress(t, s, s.collectorId)).toMatchObject({
      state: 'NOT_MINTED',
      remaining: '0',
      reached: true,
    })
    expect(fetch.calls).toHaveLength(0)
  })

  it('counts a missing total as zero, and leaves the threshold unknown without a current cache', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(await progress(t, s)).toMatchObject({
      state: 'NOT_MINTED',
      threshold: null,
      total: null,
      reached: null,
      paused: null,
    })
    const configId = await seedConfig(t, { nftContractId: OTHER_NFT })
    expect((await progress(t, s)).threshold).toBeNull()
    await t.run(({ db }) =>
      db.patch(configId, { nftContractId: NFT, chainEpoch: 'older' })
    )
    expect((await progress(t, s)).threshold).toBeNull()
    await t.run(({ db }) => db.patch(configId, { chainEpoch: EPOCH }))
    expect(await progress(t, s)).toMatchObject({
      threshold: '500000000',
      total: '0',
      remaining: '500000000',
      reached: false,
    })
  })

  it('reports MINTED from the indexed row, with its owner', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await seedConfig(t)
    const row = await indexMint(t)
    expect(await progress(t, s)).toMatchObject({
      state: 'MINTED',
      tokenId: 0,
      nftId: row._id,
      ownerAddress: AUTHOR,
    })
  })

  it('reports DISABLED, NOT_FOUND and NOT_REGISTERED', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(({ db }) => db.patch(s.chainArticleId, { status: 'SUBMITTED' }))
    expect((await progress(t, s)).state).toBe('NOT_REGISTERED')
    await t.run(({ db }) => db.delete(s.chainArticleId))
    expect((await progress(t, s)).state).toBe('NOT_REGISTERED')
    await t.run(({ db }) => db.patch(s.articleId, { published: false }))
    // Unpublished articles stay hidden, also from their author here.
    expect((await progress(t, s)).state).toBe('NOT_FOUND')
    expect((await progress(t, s, s.authorId)).state).toBe('NOT_FOUND')
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect((await progress(t, s)).state).toBe('DISABLED')
  })

  it('takes a new threshold from a threshold_set event of the configured contract', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await seedConfig(t)
    await ingest(t, [
      thresholdSetEvent(BigInt(900_000_000), { contractId: OTHER_NFT }),
    ])
    expect((await progress(t, s)).threshold).toBe('500000000')
    await ingest(t, [
      thresholdSetEvent(BigInt(700_000_000), { ledger: LEDGER + 1 }),
    ])
    expect(await progress(t, s)).toMatchObject({
      threshold: '700000000',
      thresholdToken: TOKEN,
    })
    const id = rpcEventId(LEDGER + 1, 1, 0, 0)
    expect(await eventHandled(t, id)).toBe('done')
  })

  it('stores the threshold token on the hourly config refresh', async () => {
    const t = convexTest(schema, modules)
    stubChain({ threshold: BigInt(250_000_000), paused: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await t.action(internal.chain.config.refreshChainConfig, {})
    const config = await t.run(({ db }) => db.query('chainConfig').first())
    expect(config).toMatchObject({
      nftContractId: NFT,
      nftThreshold: '250000000',
      nftThresholdToken: TOKEN,
      paused: { nft: true },
    })
  })
})
