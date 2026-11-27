/**
 * Payments v2 article NFT (docs/architecture/v2/04-nft-contract.md;
 * 05-flows-and-admin.md, section 5.10; 06-app-integration.md, sections 6.1
 * and 6.3).
 *
 * - `getMintProgress` is the reader view: the threshold progress from
 *   indexed data (`chainArticles.totals`, the cached threshold in
 *   `chainConfig`, indexed NFT rows). A query: no RPC, no rate limit.
 * - `getMintEligibility` is the author's view before a mint: it reads Core
 *   and the NFT contract live through the backend RPC and returns one typed
 *   state. Only a signed-in author causes RPC reads.
 * - `prepareMint` and `prepareTransfer` fix the values the transaction must
 *   produce on a `chainSubmissions` row (`kind: 'nft'`, `expectedNft`) and
 *   return what the client needs to build `Nft.mint(article_id)` or
 *   `Nft.transfer(from, to, token_id)`. Idempotent per `requestId`, rate
 *   limited, and gated by `CHAIN_V2_ENABLED`.
 * - The client records the hash with `chain.submissions.recordSubmitted` (or
 *   `recordSendFailed`); `checkNftSubmission` verifies it (rule (a)); the
 *   indexer's NFT handlers confirm it (rule (b)) and are the only writers of
 *   `articleNFTs` ownership.
 * - `getTokenMetadata` serves `GET /api/nft/{token_id}` (section 4.1).
 *
 * Nothing here signs or sends a transaction.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { Address, StrKey, nativeToScVal } from '@stellar/stellar-sdk'
import { ConvexError, v, type Infer } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { readView } from './chain/config'
import { readChainEnv, requireChainV2Enabled } from './lib/chain/env'
import { hexToBytes } from './lib/chain/ids'
import {
  RpcError,
  createBackendRpcClient,
  type RpcFetch,
} from './lib/chain/rpc'
import { MAX_TIME_WINDOW_SECONDS } from './lib/chain/submissionStore'
import {
  arweaveIdFromHex,
  mintNftKey,
  tokenNftKey,
  verifyNftTransaction,
  type ExpectedNft,
  type NftPrepareErrorCode,
} from './lib/chain/nftEvents'
import {
  applyNftVerification as applyNftOutcome,
  findV2ArticleNft,
  nftVerificationValidator,
  storeNftVerification,
} from './lib/chain/nftStore'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import {
  verifiedStellarAddress,
  walletLinkState,
} from './lib/walletVerification'

const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/
const MINUTE_MS = 60_000
/** Prepare calls per user per minute (mint and transfer together). */
export const NFT_PREPARE_LIMIT = 10
/** Live eligibility reads per author per minute. */
export const NFT_ELIGIBILITY_USER_LIMIT = 30

function fail(
  code: NftPrepareErrorCode,
  message: string,
  extra?: object
): never {
  throw new ConvexError({ code, message, ...extra })
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * The states `getMintEligibility` returns, in the order they are checked.
 * Only `ELIGIBLE` means "show the mint action". The states before
 * `RATE_LIMITED` are decided from Convex data alone, without RPC.
 */
export const MINT_ELIGIBILITY_STATES = [
  /** `CHAIN_V2_ENABLED` is off, or Core or the NFT contract is not configured. */
  'DISABLED',
  /** No such article, or it is unpublished and the caller is not its author. */
  'NOT_FOUND',
  /** The caller is the author and the article is unpublished. */
  'NOT_PUBLISHED',
  /** No signed-in caller. Readers use `getMintProgress`. */
  'SIGNED_OUT',
  /**
   * The caller is not the article's author, and their verified address is
   * not its author address (indexed, then live). Readers use `getMintProgress`.
   */
  'NOT_AUTHOR',
  /** The article is not registered on Core in this chain epoch. */
  'NOT_REGISTERED',
  /** Too many live reads; `retryAfterMs` says when to ask again. */
  'RATE_LIMITED',
  /** The backend RPC could not be read. Ask again later. */
  'UNAVAILABLE',
  /** The NFT exists on chain (`tokenId`); `nftId` once the indexer has it. */
  'MINTED',
  /** The author has no linked wallet. */
  'NO_WALLET',
  /** The author's linked wallet is not verified. */
  'WALLET_NOT_VERIFIED',
  /** The author's verified address is not the on-chain author (`onChainAuthor`). */
  'AUTHOR_ADDRESS_MISMATCH',
  /** A mint for this article can still land (`openSubmissionId`). */
  'PENDING',
  /** `total < threshold`; `remaining` is the difference. */
  'BELOW_THRESHOLD',
  /** The NFT contract is paused. */
  'PAUSED',
  'ELIGIBLE',
] as const
export type MintEligibilityState = (typeof MINT_ELIGIBILITY_STATES)[number]

/**
 * Amounts are decimal strings of base units of `thresholdToken` (stroops for
 * native XLM). Fields are null when the state was decided before they were
 * read.
 */
export type MintEligibility = {
  state: MintEligibilityState
  network: 'TESTNET'
  articleId: Id<'articles'>
  articleKey: string | null
  nftContractId: string | null
  coreContractId: string | null
  thresholdToken: string | null
  threshold: string | null
  total: string | null
  remaining: string | null
  onChainAuthor: string | null
  /** The caller's verified address, when signed in and verified. */
  callerAddress: string | null
  paused: boolean | null
  tokenId: number | null
  nftId: Id<'articleNFTs'> | null
  ownerAddress: string | null
  openSubmissionId: Id<'chainSubmissions'> | null
  retryAfterMs: number | null
  /** Unix milliseconds of the live read. */
  checkedAt: number
}

export const consumeEligibilityRead = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) =>
    consumeFixedWindow(
      ctx,
      `nft-eligibility:user:${args.userId}`,
      NFT_ELIGIBILITY_USER_LIMIT,
      MINUTE_MS
    ),
})

async function chainArticleFor(
  ctx: QueryCtx,
  articleId: Id<'articles'>,
  chainEpoch: string
): Promise<Doc<'chainArticles'> | null> {
  const rows = await ctx.db
    .query('chainArticles')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .take(20)
  return rows.find((row) => row.chainEpoch === chainEpoch) ?? null
}

/** A submission that can still land: sent, or prepared within its time bound. */
function isOpen(s: Doc<'chainSubmissions'>, now: number): boolean {
  if (s.status === 'SUBMITTED') return true
  return s.status === 'PREPARED' && Math.floor(now / 1000) <= s.maxTime
}

async function openSubmission(
  ctx: QueryCtx,
  nftKey: string,
  now: number,
  match: (s: Doc<'chainSubmissions'>) => boolean = () => true
): Promise<Doc<'chainSubmissions'> | null> {
  const rows = await ctx.db
    .query('chainSubmissions')
    .withIndex('by_nft_key', (q) => q.eq('nftKey', nftKey))
    .take(200)
  return (
    rows.find((s) => s.kind === 'nft' && isOpen(s, now) && match(s)) ?? null
  )
}

export const loadMintContext = internalQuery({
  args: {
    articleId: v.id('articles'),
    userId: v.union(v.id('users'), v.null()),
    chainEpoch: v.string(),
    nftContractId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return null
    const user = args.userId ? await ctx.db.get(args.userId) : null
    const chainArticle = await chainArticleFor(
      ctx,
      args.articleId,
      args.chainEpoch
    )
    const nft = await findV2ArticleNft(ctx, {
      articleId: args.articleId,
      contractId: args.nftContractId,
      chainEpoch: args.chainEpoch,
    })
    const open = chainArticle
      ? await openSubmission(
          ctx,
          mintNftKey(args.nftContractId, chainArticle.articleKey),
          args.now
        )
      : null
    return {
      published: article.published,
      isArticleAuthor: !!user && article.authorId === user._id,
      signedIn: !!user,
      linkState: user ? walletLinkState(user) : ('none' as const),
      verifiedAddress: user ? verifiedStellarAddress(user) : null,
      articleKey: chainArticle?.articleKey ?? null,
      indexedAuthor: chainArticle?.authorAddress ?? null,
      nft: nft
        ? {
            nftId: nft._id,
            tokenId: Number(nft.tokenId),
            ownerAddress: nft.ownerAddress ?? null,
          }
        : null,
      openSubmissionId: open?._id ?? null,
    }
  },
})

type ArticleRecordView = { author?: unknown } | null | undefined

/**
 * Live mint eligibility (section 5.10, step 1). Reads Core `get_article` and
 * `article_total`, and the NFT contract's `threshold`, `token_of_article` and
 * `paused`, through the backend RPC.
 *
 * Only a signed-in caller who may be the author reaches the RPC reads: the
 * article's author, or a user whose verified address is the indexed author
 * address. Everyone else gets `SIGNED_OUT` or `NOT_AUTHOR` from Convex data
 * and uses `getMintProgress` for the progress display. So the RPC cost of
 * this action is bounded per author account (`NFT_ELIGIBILITY_USER_LIMIT`),
 * and no caller can use up a limit that other callers share.
 * `fetchImpl` is for tests only.
 */
export async function readMintEligibility(
  ctx: Pick<ActionCtx, 'runQuery' | 'runMutation' | 'auth'>,
  articleId: Id<'articles'>,
  fetchImpl?: RpcFetch
): Promise<MintEligibility> {
  const chain = readChainEnv()
  const now = Date.now()
  const out: MintEligibility = {
    state: 'DISABLED',
    network: chain.network,
    articleId,
    articleKey: null,
    nftContractId: chain.nftContractId,
    coreContractId: chain.coreContractId,
    thresholdToken: null,
    threshold: null,
    total: null,
    remaining: null,
    onChainAuthor: null,
    callerAddress: null,
    paused: null,
    tokenId: null,
    nftId: null,
    ownerAddress: null,
    openSubmissionId: null,
    retryAfterMs: null,
    checkedAt: now,
  }
  if (!chain.v2Enabled || !chain.coreContractId || !chain.nftContractId) {
    return out
  }
  const userId = await getAuthUserId(ctx)
  const c = await ctx.runQuery(internal.nftsV2.loadMintContext, {
    articleId,
    userId,
    chainEpoch: chain.chainEpoch,
    nftContractId: chain.nftContractId,
    now,
  })
  if (!c || (!c.published && !c.isArticleAuthor)) {
    return { ...out, state: 'NOT_FOUND' }
  }
  out.callerAddress = c.verifiedAddress
  out.nftId = c.nft?.nftId ?? null
  out.ownerAddress = c.nft?.ownerAddress ?? null
  out.openSubmissionId = c.openSubmissionId
  if (!c.published) return { ...out, state: 'NOT_PUBLISHED' }
  if (!userId || !c.signedIn) return { ...out, state: 'SIGNED_OUT' }
  const mayBeAuthor =
    c.isArticleAuthor ||
    (!!c.verifiedAddress && c.verifiedAddress === c.indexedAuthor)
  if (!mayBeAuthor) return { ...out, state: 'NOT_AUTHOR' }
  if (!c.articleKey) return { ...out, state: 'NOT_REGISTERED' }
  out.articleKey = c.articleKey
  const limit = await ctx.runMutation(internal.nftsV2.consumeEligibilityRead, {
    userId,
  })
  if (!limit.ok) {
    return { ...out, state: 'RATE_LIMITED', retryAfterMs: limit.retryAfterMs }
  }

  const rpc = createBackendRpcClient(fetchImpl)
  const key = nativeToScVal(hexToBytes(c.articleKey))
  let record: ArticleRecordView
  let tokenOf: unknown
  try {
    const [rec, threshold, token, paused] = await Promise.all([
      readView(rpc, chain, chain.coreContractId, 'get_article', [key]),
      readView(rpc, chain, chain.nftContractId, 'threshold'),
      readView(rpc, chain, chain.nftContractId, 'token_of_article', [key]),
      readView(rpc, chain, chain.nftContractId, 'paused'),
    ])
    record = rec as ArticleRecordView
    tokenOf = token
    if (!Array.isArray(threshold) || threshold.length !== 2) {
      throw new Error('threshold: unexpected value')
    }
    out.thresholdToken = String(threshold[0])
    out.threshold = String(threshold[1])
    out.paused = Boolean(paused)
    if (record) {
      out.onChainAuthor = String(record.author)
      const total = await readView(
        rpc,
        chain,
        chain.coreContractId,
        'article_total',
        [key, new Address(out.thresholdToken).toScVal()]
      )
      out.total = String(total)
      const gap = BigInt(out.threshold) - BigInt(out.total)
      out.remaining = (gap > BigInt(0) ? gap : BigInt(0)).toString()
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        code: 'NFT_ELIGIBILITY_READ_FAILED',
        articleId,
        message: error instanceof Error ? error.message : String(error),
      })
    )
    return { ...out, state: 'UNAVAILABLE' }
  }

  if (!record) return { ...out, state: 'NOT_REGISTERED' }
  if (tokenOf !== null && tokenOf !== undefined) {
    return { ...out, state: 'MINTED', tokenId: Number(tokenOf) }
  }
  const isOnChainAuthor =
    !!c.verifiedAddress && c.verifiedAddress === out.onChainAuthor
  if (!isOnChainAuthor) {
    if (!c.isArticleAuthor) return { ...out, state: 'NOT_AUTHOR' }
    if (c.linkState === 'none') return { ...out, state: 'NO_WALLET' }
    if (c.linkState !== 'verified') {
      return { ...out, state: 'WALLET_NOT_VERIFIED' }
    }
    return { ...out, state: 'AUTHOR_ADDRESS_MISMATCH' }
  }
  if (c.openSubmissionId) return { ...out, state: 'PENDING' }
  if (BigInt(out.total!) < BigInt(out.threshold!)) {
    return { ...out, state: 'BELOW_THRESHOLD' }
  }
  if (out.paused) return { ...out, state: 'PAUSED' }
  return { ...out, state: 'ELIGIBLE' }
}

export const getMintEligibility = action({
  args: { articleId: v.id('articles') },
  handler: (ctx, args): Promise<MintEligibility> =>
    readMintEligibility(ctx, args.articleId),
})

// ---------------------------------------------------------------------------
// Reader progress (indexed data, no RPC)
// ---------------------------------------------------------------------------

/** The states `getMintProgress` returns, in the order they are checked. */
export const MINT_PROGRESS_STATES = [
  /** `CHAIN_V2_ENABLED` is off, or the NFT contract is not configured. */
  'DISABLED',
  /** No such article, or it is unpublished. */
  'NOT_FOUND',
  /** No registered `chainArticles` row in this chain epoch. */
  'NOT_REGISTERED',
  /** An indexed v2 NFT exists (`tokenId`, `nftId`, `ownerAddress`). */
  'MINTED',
  /** No indexed NFT yet. `threshold` is null until the config cache has it. */
  'NOT_MINTED',
] as const
export type MintProgressState = (typeof MINT_PROGRESS_STATES)[number]

/**
 * Threshold progress from indexed data. Amounts are decimal strings of base
 * units of `thresholdToken`. The values can lag the chain: totals by the
 * indexer delay, the threshold and pause state by up to the hourly config
 * refresh (a `threshold_set` event updates the threshold sooner). The
 * author's mint decision uses `getMintEligibility`, which reads live.
 */
export type MintProgress = {
  state: MintProgressState
  network: 'TESTNET'
  articleId: Id<'articles'>
  nftContractId: string | null
  thresholdToken: string | null
  threshold: string | null
  total: string | null
  remaining: string | null
  /** `total >= threshold`, or null when the threshold is not known. */
  reached: boolean | null
  paused: boolean | null
  tokenId: number | null
  nftId: Id<'articleNFTs'> | null
  ownerAddress: string | null
  /** Unix milliseconds of the last threshold and pause read from the contract. */
  configRefreshedAt: number | null
  /** Unix milliseconds of the last change to the article's chain record. */
  chainArticleUpdatedAt: number | null
}

/**
 * The cached config row (`chainConfig`) when it describes the configured NFT
 * contract in this chain epoch, otherwise null. `refreshChainConfig` fills it
 * and the indexer updates the threshold and the pause flag from NFT events.
 */
async function cachedNftConfig(
  ctx: QueryCtx,
  chain: Pick<ReturnType<typeof readChainEnv>, 'network' | 'chainEpoch'> & {
    nftContractId: string | null
  }
): Promise<Doc<'chainConfig'> | null> {
  if (!chain.nftContractId) return null
  const config = await ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  return config &&
    config.chainEpoch === chain.chainEpoch &&
    config.nftContractId === chain.nftContractId
    ? config
    : null
}

/** Refuses with `PAUSED` while the cached config says the NFT contract is paused. */
async function requireNftOpen(
  ctx: QueryCtx,
  chain: Caller['chain'],
  action: 'mint' | 'transfer'
): Promise<void> {
  const config = await cachedNftConfig(ctx, chain)
  if (config?.paused.nft === true) {
    fail(
      'PAUSED',
      action === 'mint'
        ? 'Minting is paused. Try again later.'
        : 'NFT transfers are paused. Try again later.'
    )
  }
}

export const getMintProgress = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args): Promise<MintProgress> => {
    const chain = readChainEnv()
    const out: MintProgress = {
      state: 'DISABLED',
      network: chain.network,
      articleId: args.articleId,
      nftContractId: chain.nftContractId,
      thresholdToken: null,
      threshold: null,
      total: null,
      remaining: null,
      reached: null,
      paused: null,
      tokenId: null,
      nftId: null,
      ownerAddress: null,
      configRefreshedAt: null,
      chainArticleUpdatedAt: null,
    }
    if (!chain.v2Enabled || !chain.nftContractId) return out
    const article = await ctx.db.get(args.articleId)
    if (!article || !article.published) return { ...out, state: 'NOT_FOUND' }
    const chainArticle = await chainArticleFor(
      ctx,
      args.articleId,
      chain.chainEpoch
    )
    if (!chainArticle || chainArticle.status !== 'REGISTERED') {
      return { ...out, state: 'NOT_REGISTERED' }
    }
    const current = await cachedNftConfig(ctx, chain)
    const nft = await findV2ArticleNft(ctx, {
      articleId: args.articleId,
      contractId: chain.nftContractId,
      chainEpoch: chain.chainEpoch,
    })
    if (nft) {
      return {
        ...out,
        state: 'MINTED',
        tokenId: Number(nft.tokenId),
        nftId: nft._id,
        ownerAddress: nft.ownerAddress ?? null,
        // The owner's transfer action follows this flag.
        paused: current?.paused.nft ?? null,
        configRefreshedAt: current?.refreshedAt ?? null,
      }
    }
    const token = current?.nftThresholdToken ?? null
    const threshold = token ? (current?.nftThreshold ?? null) : null
    const total = token ? (chainArticle.totals[token] ?? '0') : null
    let remaining: string | null = null
    let reached: boolean | null = null
    if (threshold !== null && total !== null) {
      const gap = BigInt(threshold) - BigInt(total)
      remaining = (gap > BigInt(0) ? gap : BigInt(0)).toString()
      reached = gap <= BigInt(0)
    }
    return {
      ...out,
      state: 'NOT_MINTED',
      thresholdToken: token,
      threshold,
      total,
      remaining,
      reached,
      paused: current?.paused.nft ?? null,
      configRefreshedAt: current?.refreshedAt ?? null,
      chainArticleUpdatedAt: chainArticle.updatedAt,
    }
  },
})

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

type PreparedBase = {
  submissionId: Id<'chainSubmissions'>
  /** True when an earlier call with the same `requestId` created it. */
  existing: boolean
  network: 'TESTNET'
  networkPassphrase: string
  /** The NFT contract. */
  contractId: string
  /** Unix seconds: the transaction's upper time bound (`[0, maxTime]`). */
  maxTime: number
  /** The only address that signs; also the transaction source. */
  signer: string
}

/** Everything the client needs to build `Nft.mint(article_id)`. */
export type PreparedNftMint = PreparedBase & {
  action: 'mint'
  method: 'mint'
  args: { article_id: string }
  articleId: Id<'articles'>
  /** Core `article_id`, 32 bytes, lowercase hex (same as `args.article_id`). */
  articleKey: string
}

/** Everything the client needs to build `Nft.transfer(from, to, token_id)`. */
export type PreparedNftTransfer = PreparedBase & {
  action: 'transfer'
  method: 'transfer'
  args: { from: string; to: string; token_id: number }
  nftId: Id<'articleNFTs'>
  tokenId: number
  recipient: {
    address: string
    userId: Id<'users'> | null
    username: string | null
  }
}

export type PreparedNftCall = PreparedNftMint | PreparedNftTransfer

type Caller = {
  userId: Id<'users'>
  chain: ReturnType<typeof requireChainV2Enabled> & {
    coreContractId: string
    nftContractId: string
  }
  verifiedAddress: string
}

async function caller(ctx: MutationCtx): Promise<Caller> {
  const chain = requireChainV2Enabled()
  if (!chain.coreContractId || !chain.nftContractId) {
    fail(
      'CHAIN_CONFIG_MISSING',
      'CORE_CONTRACT_ID and NFT_CONTRACT_ID must be set.'
    )
  }
  const userId = await getAuthUserId(ctx)
  if (!userId) fail('UNAUTHENTICATED', 'Sign in first.')
  const user = await ctx.db.get(userId)
  if (!user) fail('UNAUTHENTICATED', 'Sign in first.')
  const state = walletLinkState(user, chain.passphrase)
  if (state === 'none') fail('NO_WALLET', 'Connect your wallet first.')
  const verifiedAddress = verifiedStellarAddress(user, chain.passphrase)
  if (state !== 'verified' || !verifiedAddress) {
    fail('WALLET_NOT_VERIFIED', 'Verify your wallet first.')
  }
  return { userId, chain: chain as Caller['chain'], verifiedAddress }
}

function checkRequestId(requestId: string): void {
  if (!REQUEST_ID.test(requestId)) {
    fail(
      'INVALID_PREPARE',
      'requestId must be 1 to 100 letters, digits, "-" or "_".'
    )
  }
}

async function byRequest(
  ctx: MutationCtx,
  requestId: string
): Promise<Doc<'chainSubmissions'> | null> {
  return ctx.db
    .query('chainSubmissions')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .first()
}

async function enforcePrepareLimit(
  ctx: MutationCtx,
  userId: Id<'users'>
): Promise<void> {
  const limit = await consumeFixedWindow(
    ctx,
    `nft-prepare:${userId}`,
    NFT_PREPARE_LIMIT,
    MINUTE_MS
  )
  if (!limit.ok) {
    fail('RATE_LIMITED', 'Too many requests. Try again shortly.', {
      retryAfterMs: limit.retryAfterMs,
    })
  }
}

async function latestKnownLedger(
  ctx: MutationCtx
): Promise<number | undefined> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', 'TESTNET'))
    .first()
  return cursor?.latestLedger
}

async function insertNftSubmission(
  ctx: MutationCtx,
  c: Caller,
  args: {
    requestId: string
    nftKey: string
    expected: NonNullable<Doc<'chainSubmissions'>['expectedNft']>
    now: number
  }
): Promise<Doc<'chainSubmissions'>> {
  const createdLedger = await latestKnownLedger(ctx)
  const id = await ctx.db.insert('chainSubmissions', {
    network: c.chain.network,
    chainEpoch: c.chain.chainEpoch,
    kind: 'nft',
    userId: c.userId,
    contractId: c.chain.nftContractId,
    requestId: args.requestId,
    expectedNft: args.expected,
    nftKey: args.nftKey,
    // NFT calls carry no client_ref; the article or token identifies them.
    clientRefs: [],
    maxTime: Math.floor(args.now / 1000) + MAX_TIME_WINDOW_SECONDS,
    ...(createdLedger === undefined ? {} : { createdLedger }),
    status: 'PREPARED',
    attempts: 0,
    related: [],
    createdAt: args.now,
    updatedAt: args.now,
  })
  return (await ctx.db.get(id))!
}

function base(
  s: Doc<'chainSubmissions'>,
  c: Pick<Caller, 'chain'>,
  existing: boolean
): PreparedBase {
  return {
    submissionId: s._id,
    existing,
    network: c.chain.network,
    networkPassphrase: c.chain.passphrase,
    contractId: s.contractId,
    maxTime: s.maxTime,
    signer: s.expectedNft!.signer,
  }
}

function toPreparedMint(
  s: Doc<'chainSubmissions'>,
  c: Pick<Caller, 'chain'>,
  existing: boolean
): PreparedNftMint {
  const e = s.expectedNft!
  if (e.action !== 'mint') fail('INVALID_PREPARE', 'Not a mint request.')
  return {
    ...base(s, c, existing),
    action: 'mint',
    method: 'mint',
    args: { article_id: e.articleKey },
    articleId: e.articleId,
    articleKey: e.articleKey,
  }
}

async function toPreparedTransfer(
  ctx: QueryCtx,
  s: Doc<'chainSubmissions'>,
  c: Pick<Caller, 'chain'>,
  existing: boolean
): Promise<PreparedNftTransfer> {
  const e = s.expectedNft!
  if (e.action !== 'transfer') {
    fail('INVALID_PREPARE', 'Not a transfer request.')
  }
  const user = e.toUserId ? await ctx.db.get(e.toUserId) : null
  return {
    ...base(s, c, existing),
    action: 'transfer',
    method: 'transfer',
    args: { from: e.from, to: e.to, token_id: e.tokenId },
    nftId: e.nftId,
    tokenId: e.tokenId,
    recipient: {
      address: e.to,
      userId: e.toUserId ?? null,
      username: user?.username ?? null,
    },
  }
}

/**
 * Prepares `Nft.mint(article_id)` for the article's on-chain author. Uses the
 * indexed registration (`chainArticles`); the contract enforces the
 * threshold, so a mint below it fails in simulation (`BelowThreshold`, 70)
 * and nothing is submitted.
 */
export const prepareMint = mutation({
  args: { articleId: v.id('articles'), requestId: v.string() },
  handler: async (ctx, args): Promise<PreparedNftMint> => {
    const c = await caller(ctx)
    checkRequestId(args.requestId)
    const earlier = await byRequest(ctx, args.requestId)
    if (earlier) {
      const e = earlier.expectedNft
      if (
        earlier.userId !== c.userId ||
        earlier.kind !== 'nft' ||
        e?.action !== 'mint' ||
        e.articleId !== args.articleId
      ) {
        fail('INVALID_PREPARE', 'requestId belongs to another request.')
      }
      return toPreparedMint(earlier, c, true)
    }

    const article = await ctx.db.get(args.articleId)
    if (!article) fail('NOT_FOUND', 'Article not found.')
    if (!article.published) fail('NOT_PUBLISHED', 'Publish the article first.')
    const chainArticle = await chainArticleFor(
      ctx,
      args.articleId,
      c.chain.chainEpoch
    )
    if (!chainArticle || chainArticle.status !== 'REGISTERED') {
      fail('NOT_REGISTERED', 'This article is not registered on Stellar yet.')
    }
    if (chainArticle.authorAddress !== c.verifiedAddress) {
      fail(
        'NOT_ONCHAIN_AUTHOR',
        'Only the wallet registered as this article’s author can mint its NFT.',
        { onChainAuthor: chainArticle.authorAddress }
      )
    }
    const minted = await findV2ArticleNft(ctx, {
      articleId: args.articleId,
      contractId: c.chain.nftContractId,
      chainEpoch: c.chain.chainEpoch,
    })
    if (minted) {
      fail('ALREADY_MINTED', 'This article’s NFT is already minted.', {
        nftId: minted._id,
        tokenId: Number(minted.tokenId),
      })
    }
    await requireNftOpen(ctx, c.chain, 'mint')
    const now = Date.now()
    const nftKey = mintNftKey(c.chain.nftContractId, chainArticle.articleKey)
    const open = await openSubmission(ctx, nftKey, now)
    if (open) {
      fail('PENDING', 'A mint for this article is still in progress.', {
        submissionId: open._id,
      })
    }
    await enforcePrepareLimit(ctx, c.userId)
    const submission = await insertNftSubmission(ctx, c, {
      requestId: args.requestId,
      nftKey,
      expected: {
        action: 'mint',
        articleKey: chainArticle.articleKey,
        articleId: args.articleId,
        signer: c.verifiedAddress,
      },
      now,
    })
    return toPreparedMint(submission, c, false)
  },
})

const recipientArg = v.union(
  v.object({ kind: v.literal('address'), address: v.string() }),
  v.object({ kind: v.literal('user'), username: v.string() })
)

/**
 * The configured Quilltip contracts and the tip token. None of them can move
 * an NFT it receives, so a token sent there is lost.
 */
function platformContracts(chain: Caller['chain']): Set<string> {
  return new Set(
    [
      chain.nftContractId,
      chain.coreContractId,
      chain.tabContractId,
      chain.tokenContractId,
    ].filter((id): id is string => !!id)
  )
}

async function resolveRecipient(
  ctx: MutationCtx,
  chain: Caller['chain'],
  recipient: Infer<typeof recipientArg>
): Promise<{ address: string; userId?: Id<'users'> }> {
  const resolved = await resolveRecipientAddress(ctx, recipient)
  if (platformContracts(chain).has(resolved.address)) {
    fail(
      'INVALID_RECIPIENT',
      'That address is a Quilltip contract and cannot hold the NFT.'
    )
  }
  return resolved
}

async function resolveRecipientAddress(
  ctx: MutationCtx,
  recipient: Infer<typeof recipientArg>
): Promise<{ address: string; userId?: Id<'users'> }> {
  if (recipient.kind === 'address') {
    const address = recipient.address.trim()
    // Account (G…) or contract (C…) addresses; muxed (M…) addresses are not
    // Soroban `Address` values.
    if (
      !StrKey.isValidEd25519PublicKey(address) &&
      !StrKey.isValidContract(address)
    ) {
      fail('INVALID_RECIPIENT', 'Enter a valid Stellar address.')
    }
    return { address }
  }
  const handle = recipient.username.trim().replace(/^@/, '')
  if (!handle) fail('INVALID_RECIPIENT', 'Enter a username.')
  const user =
    (await ctx.db
      .query('users')
      .withIndex('by_username_lower', (q) =>
        q.eq('usernameLower', handle.toLowerCase())
      )
      .first()) ??
    (await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', handle))
      .first())
  if (!user) fail('RECIPIENT_NOT_FOUND', 'No Quilltip user has that username.')
  const address = verifiedStellarAddress(user)
  if (!address) {
    fail(
      'RECIPIENT_NO_WALLET',
      'That user has no verified wallet to receive the NFT.'
    )
  }
  return { address, userId: user._id }
}

/**
 * Prepares `Nft.transfer(from, to, token_id)` from the caller's verified
 * address, which must be the indexed owner. The recipient is a Stellar
 * address, or a Quilltip user resolved to their verified address.
 */
export const prepareTransfer = mutation({
  args: {
    nftId: v.id('articleNFTs'),
    recipient: recipientArg,
    requestId: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedNftTransfer> => {
    const c = await caller(ctx)
    checkRequestId(args.requestId)
    const earlier = await byRequest(ctx, args.requestId)
    if (earlier) {
      const e = earlier.expectedNft
      if (
        earlier.userId !== c.userId ||
        earlier.kind !== 'nft' ||
        e?.action !== 'transfer' ||
        e.nftId !== args.nftId
      ) {
        fail('INVALID_PREPARE', 'requestId belongs to another request.')
      }
      return toPreparedTransfer(ctx, earlier, c, true)
    }

    const nft = await ctx.db.get(args.nftId)
    if (!nft) fail('NOT_FOUND', 'NFT not found.')
    if (
      nft.contractVersion !== 'v2' ||
      nft.contractAddress !== c.chain.nftContractId ||
      nft.chainEpoch !== c.chain.chainEpoch
    ) {
      fail('NOT_V2_NFT', 'This NFT is a v1 record and cannot be transferred.')
    }
    if (nft.ownerAddress !== c.verifiedAddress) {
      fail('NOT_OWNER', 'Your verified wallet does not own this NFT.')
    }
    const to = await resolveRecipient(ctx, c.chain, args.recipient)
    if (to.address === c.verifiedAddress) {
      fail('SELF_TRANSFER', 'This NFT is already in that wallet.')
    }
    await requireNftOpen(ctx, c.chain, 'transfer')
    const tokenId = Number(nft.tokenId)
    const now = Date.now()
    const nftKey = tokenNftKey(c.chain.nftContractId, tokenId)
    const open = await openSubmission(ctx, nftKey, now)
    if (open) {
      fail('PENDING', 'A transfer of this NFT is still in progress.', {
        submissionId: open._id,
      })
    }
    await enforcePrepareLimit(ctx, c.userId)
    const submission = await insertNftSubmission(ctx, c, {
      requestId: args.requestId,
      nftKey,
      expected: {
        action: 'transfer',
        nftId: nft._id,
        tokenId,
        signer: c.verifiedAddress,
        from: c.verifiedAddress,
        to: to.address,
        ...(to.userId ? { toUserId: to.userId } : {}),
      },
      now,
    })
    return toPreparedTransfer(ctx, submission, c, false)
  },
})

// ---------------------------------------------------------------------------
// Status and verification
// ---------------------------------------------------------------------------

export type NftSubmissionStatus = {
  submissionId: Id<'chainSubmissions'>
  action: 'mint' | 'transfer'
  status: Doc<'chainSubmissions'>['status']
  txHash: string | null
  maxTime: number
  mismatchReason: string | null
  needsReview: boolean
  /** Offered only after FAILED or EXPIRED, never after MISMATCH. */
  canRetry: boolean
  /**
   * True once the indexer has applied the event: the row exists (mint) or
   * the transfer is in the history and ownership moved. Ownership in the UI
   * follows `nft`, which only the indexer writes.
   */
  indexed: boolean
  nft: {
    nftId: Id<'articleNFTs'>
    tokenId: number
    ownerAddress: string | null
    contractId: string | null
  } | null
}

/** Status of the caller's own NFT submission, for the UI to poll. */
export const getNftSubmissionStatus = query({
  args: { submissionId: v.id('chainSubmissions') },
  handler: async (ctx, args): Promise<NftSubmissionStatus | null> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const s = await ctx.db.get(args.submissionId)
    if (!s || s.userId !== userId || s.kind !== 'nft' || !s.expectedNft) {
      return null
    }
    const e = s.expectedNft
    let nft: Doc<'articleNFTs'> | null
    let indexed = false
    if (e.action === 'mint') {
      nft = await findV2ArticleNft(ctx, {
        articleId: e.articleId,
        contractId: s.contractId,
        chainEpoch: s.chainEpoch,
      })
      indexed = !!nft
    } else {
      nft = await ctx.db.get(e.nftId)
      if (s.txHash) {
        const rows = await ctx.db
          .query('nftTransfers')
          .withIndex('by_nft', (q) => q.eq('nftId', e.nftId))
          .take(200)
        indexed = rows.some((r) => r.transactionId === s.txHash)
      }
    }
    return {
      submissionId: s._id,
      action: e.action,
      status: s.status,
      txHash: s.txHash ?? null,
      maxTime: s.maxTime,
      mismatchReason: s.mismatchReason ?? null,
      needsReview: s.needsReview === true,
      canRetry:
        (s.status === 'FAILED' || s.status === 'EXPIRED') &&
        s.needsReview !== true,
      indexed,
      nft: nft
        ? {
            nftId: nft._id,
            tokenId: Number(nft.tokenId),
            ownerAddress: nft.ownerAddress ?? null,
            contractId: nft.contractAddress ?? null,
          }
        : null,
    }
  },
})

export const applyNftVerification = internalMutation({
  args: {
    submissionId: v.id('chainSubmissions'),
    txHash: v.string(),
    ledger: v.number(),
    outcome: nftVerificationValidator,
  },
  handler: async (ctx, args): Promise<'applied' | 'skipped'> =>
    applyNftOutcome(ctx, { ...args, now: Date.now() }),
})

function expectedOf(
  e: NonNullable<Doc<'chainSubmissions'>['expectedNft']>
): ExpectedNft {
  return e.action === 'mint'
    ? { action: 'mint', articleKey: e.articleKey, signer: e.signer }
    : { action: 'transfer', tokenId: e.tokenId, from: e.from, to: e.to }
}

export type NftCheckResult =
  | 'confirmed_or_mismatch'
  | 'failed'
  | 'not_found'
  | 'rpc_error'
  | 'skipped'

/**
 * One RPC check of a submitted NFT transaction (rule (a)), called by
 * `chain.submissions.checkSubmission` for `kind: 'nft'`. The caller has
 * already checked that the submission has a hash and an open status.
 */
export async function checkNftSubmission(
  ctx: Pick<ActionCtx, 'runMutation'>,
  submission: Doc<'chainSubmissions'>,
  fetchImpl?: RpcFetch
): Promise<{ result: NftCheckResult; maxTime: number }> {
  const maxTime = submission.maxTime
  if (!submission.expectedNft || !submission.txHash) {
    return { result: 'skipped', maxTime }
  }
  const rpc = createBackendRpcClient(fetchImpl)
  let tx
  try {
    tx = await rpc.getTransaction(submission.txHash)
  } catch (error) {
    await ctx.runMutation(internal.chain.submissions.noteAttempt, {
      submissionId: submission._id,
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof RpcError) return { result: 'rpc_error', maxTime }
    throw error
  }
  await ctx.runMutation(internal.chain.submissions.noteAttempt, {
    submissionId: submission._id,
  })
  if (tx.status === 'NOT_FOUND') return { result: 'not_found', maxTime }
  if (tx.status === 'FAILED') {
    await ctx.runMutation(internal.chain.submissions.applyRpcFailed, {
      submissionId: submission._id,
      txHash: submission.txHash,
    })
    return { result: 'failed', maxTime }
  }
  const outcome = verifyNftTransaction({
    expected: expectedOf(submission.expectedNft),
    nftContractId: submission.contractId,
    contractEventsXdr: tx.contractEventsXdr,
    ledger: tx.ledger!,
    createdLedger: submission.createdLedger ?? null,
  })
  await ctx.runMutation(internal.nftsV2.applyNftVerification, {
    submissionId: submission._id,
    txHash: submission.txHash,
    ledger: tx.ledger!,
    outcome: storeNftVerification(outcome),
  })
  return { result: 'confirmed_or_mismatch', maxTime }
}

// ---------------------------------------------------------------------------
// Metadata (GET /api/nft/{token_id})
// ---------------------------------------------------------------------------

export type NftTokenMetadata = {
  tokenId: number
  network: 'TESTNET' | 'MAINNET'
  contractId: string
  /** False when the article is unpublished or deleted. */
  available: boolean
  title: string | null
  excerpt: string | null
  authorUsername: string | null
  slug: string | null
  /**
   * Core `content_hash` of the latest anchored version, lowercase hex. Null,
   * like `contentVersion` and `arweaveId`, when the article is not available.
   */
  contentHash: string | null
  contentVersion: number | null
  /** Arweave transaction ID (base64url), when the article anchors one. */
  arweaveId: string | null
  minterAddress: string | null
  /** Unix milliseconds (ledger close time of the mint). */
  mintedAt: number
}

/**
 * Public metadata of a v2 token of the configured NFT contract, or null when
 * the token is unknown to this deployment (not minted, or not indexed yet).
 */
export const getTokenMetadata = query({
  args: { tokenId: v.number() },
  handler: async (ctx, args): Promise<NftTokenMetadata | null> => {
    if (
      !Number.isInteger(args.tokenId) ||
      args.tokenId < 0 ||
      args.tokenId > 0xffffffff
    ) {
      return null
    }
    const chain = readChainEnv()
    if (!chain.nftContractId) return null
    const rows = await ctx.db
      .query('articleNFTs')
      .withIndex('by_token_id', (q) => q.eq('tokenId', String(args.tokenId)))
      .take(200)
    const nft = rows.find(
      (r) =>
        r.contractVersion === 'v2' &&
        r.contractAddress === chain.nftContractId &&
        r.chainEpoch === chain.chainEpoch
    )
    if (!nft) return null
    const [article, chainArticle] = await Promise.all([
      ctx.db.get(nft.articleId),
      chainArticleFor(ctx, nft.articleId, chain.chainEpoch),
    ])
    const available = !!article && article.published
    // The anchored content leads to the article body (the Arweave copy), so
    // it is shown only while the article is published.
    const anchor =
      available &&
      chainArticle &&
      chainArticle.articleKey === nft.chainArticleKey
        ? chainArticle
        : null
    return {
      tokenId: args.tokenId,
      network: nft.network ?? chain.network,
      contractId: chain.nftContractId,
      available,
      title: available ? article!.title : null,
      excerpt: available ? (article!.excerpt ?? null) : null,
      authorUsername: available ? article!.authorUsername : null,
      slug: available ? article!.slug : null,
      contentHash: anchor?.contentHash ?? null,
      contentVersion: anchor?.contentVersion ?? null,
      arweaveId: arweaveIdFromHex(anchor?.arweaveId),
      minterAddress: nft.minterAddress ?? null,
      mintedAt: nft.mintedAt,
    }
  },
})
