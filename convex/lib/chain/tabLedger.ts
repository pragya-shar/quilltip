/**
 * The off-chain tab ledger (docs/architecture/v2/03-tab-contract.md, sections
 * 3.4 to 3.7; 05-flows-and-admin.md, sections 5.5 to 5.9; 06-app-integration.md,
 * sections 6.2 and 6.3).
 *
 * - `prepareTabTip` and `submitTabTip` implement 5.6. `submitTabTip` enforces
 *   I-22 in one mutation: it re-checks every rule against the current state,
 *   so two submits that race on one tab are serialised by Convex and the
 *   second sees the first one's effect (a changed `seq`, balance or limit).
 * - On-chain facts (balance, key registration, payments) change only through
 *   the Tab event handlers in `tabEventHandlers.ts`; client input never sets
 *   them.
 * - Tab earnings per `(reader, key_id, writer)` follow the cumulative fee rule
 *   (I-31): `earned = netOf(paidOnChain)`, `pending = netOf(cumulative) −
 *   netOf(paidOnChain)` while the pair can settle, else 0.
 */
import { ConvexError } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { creditAuthorEarnings, roundCents } from '../authorEarnings'
import {
  isStellarAddressVerified,
  verifiedStellarAddress,
} from '../walletVerification'
import { requireChainV2Enabled, type ChainEnv } from './env'
import { BPS_DENOMINATOR, FEE_BPS } from './fees'
import { highlightIdHex, isHexOfLength, newClientRefHex } from './ids'
import type { TabReceiptStatus } from './schema'
import {
  MAX_RECEIPTS_PER_PAIR,
  loadAcceptor,
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  verifyEd25519,
  voucherPayloadBytes,
  type StoredReceipt,
} from './voucher'
import { hexToBytes } from './ids'

type EnvLike = Record<string, string | undefined>

/** Ledgers per day at the 5-second target close time (contracts/shared). */
export const DAY_LEDGERS = 17_280
export const LEDGER_SECONDS = 5
/** The contract accepts vouchers until `valid_until + SETTLE_GRACE`. */
export const SETTLE_GRACE_LEDGERS = 7 * DAY_LEDGERS
/** Convex stops accepting under a key 1 day before `valid_until` (3.5). */
export const ACCEPT_MARGIN_LEDGERS = DAY_LEDGERS
/** Contract maximum key lifetime (3.1). */
export const MAX_KEY_LIFETIME_LEDGERS = 30 * DAY_LEDGERS
/** A prepared tab tip must be submitted within this time. */
export const TAB_PREPARE_TTL_MS = 300_000
/** A cached XLM price older than this is not used to price a tab tip. */
export const TAB_PRICE_MAX_AGE_MS = 30 * 60 * 1000
export const DEFAULT_TAB_DAILY_LIMIT = BigInt(200_000_000)
export const DEFAULT_TAB_TIP_MAX = BigInt(50_000_000)
/** Out-of-order bookkeeping kept per account (see `applyBalanceDebit`). */
export const MAX_SETTLED_SINCE_BALANCE = 256

const ZERO = BigInt(0)
const STROOPS_PER_XLM = 10_000_000

export function tabError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

// ---------------------------------------------------------------------------
// Numbers and settings

/** `x − floor(x × 250 / 10,000)`: the writer's share of a cumulative amount. */
export function netOf(x: bigint): bigint {
  return x - (x * BigInt(FEE_BPS)) / BigInt(BPS_DENOMINATOR)
}

function big(value: string): bigint {
  return BigInt(value)
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

function positiveSetting(env: EnvLike, name: string, fallback: bigint) {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  if (!/^[1-9][0-9]{0,30}$/.test(raw)) {
    tabError('TAB_CONFIG_INVALID', `${name} must be a positive integer.`)
  }
  return BigInt(raw)
}

export type TabLimits = { dailyLimit: bigint; tipMax: bigint }

export function tabLimits(env: EnvLike = process.env): TabLimits {
  return {
    dailyLimit: positiveSetting(
      env,
      'TAB_DAILY_LIMIT',
      DEFAULT_TAB_DAILY_LIMIT
    ),
    tipMax: positiveSetting(env, 'TAB_TIP_MAX', DEFAULT_TAB_TIP_MAX),
  }
}

/** The UTC day `YYYY-MM-DD` of a timestamp. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

type TabChain = ChainEnv & { tabContractId: string; tokenContractId: string }

export function requireTabChain(env?: EnvLike): TabChain {
  const chain = requireChainV2Enabled(env)
  if (!chain.tabContractId || !chain.tokenContractId) {
    tabError(
      'CHAIN_CONFIG_MISSING',
      'TAB_CONTRACT_ID and TOKEN_CONTRACT_ID must be set.'
    )
  }
  return chain as TabChain
}

/**
 * The current ledger, estimated from the indexer cursor. Acceptance is
 * refused while the indexer is stopped, because the balance and key state
 * may then be behind the chain.
 */
export async function currentLedgerEstimate(
  ctx: QueryCtx,
  chain: Pick<ChainEnv, 'network' | 'chainEpoch'>,
  now: number
): Promise<number> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (
    !cursor ||
    cursor.chainEpoch !== chain.chainEpoch ||
    cursor.status === 'BEHIND_RETENTION' ||
    cursor.status === 'RESET_DETECTED' ||
    cursor.latestLedger <= 0
  ) {
    tabError(
      'TAB_CHAIN_STATE_UNKNOWN',
      'The tab ledger is not in step with the chain. Try again later.'
    )
  }
  const elapsed = Math.max(0, now - cursor.updatedAt)
  return cursor.latestLedger + Math.floor(elapsed / (LEDGER_SECONDS * 1000))
}

// ---------------------------------------------------------------------------
// Lookups

export async function tabAccountForReader(
  ctx: QueryCtx,
  readerAddress: string,
  chainEpoch: string
): Promise<Doc<'tabAccounts'> | null> {
  const rows = await ctx.db
    .query('tabAccounts')
    .withIndex('by_reader', (q) => q.eq('readerAddress', readerAddress))
    .take(20)
  return rows.find((row) => row.chainEpoch === chainEpoch) ?? null
}

export async function tabKey(
  ctx: QueryCtx,
  tabAccountId: Id<'tabAccounts'>,
  keyId: number
): Promise<Doc<'tabSessionKeys'> | null> {
  return ctx.db
    .query('tabSessionKeys')
    .withIndex('by_account_key', (q) =>
      q.eq('tabAccountId', tabAccountId).eq('keyId', keyId)
    )
    .first()
}

export async function tabVoucher(
  ctx: QueryCtx,
  tabAccountId: Id<'tabAccounts'>,
  keyId: number,
  writerAddress: string
): Promise<Doc<'tabVouchers'> | null> {
  return ctx.db
    .query('tabVouchers')
    .withIndex('by_pair', (q) =>
      q
        .eq('tabAccountId', tabAccountId)
        .eq('keyId', keyId)
        .eq('writerAddress', writerAddress)
    )
    .first()
}

export async function pairReceipts(
  ctx: QueryCtx,
  voucher: Pick<Doc<'tabVouchers'>, 'tabAccountId' | 'keyId' | 'writerAddress'>
): Promise<Doc<'tabReceipts'>[]> {
  return ctx.db
    .query('tabReceipts')
    .withIndex('by_pair_seq', (q) =>
      q
        .eq('tabAccountId', voucher.tabAccountId)
        .eq('keyId', voucher.keyId)
        .eq('writerAddress', voucher.writerAddress)
    )
    .take(MAX_RECEIPTS_PER_PAIR + 1)
}

/** The only user that verified `address` on this network, if exactly one. */
export async function uniqueVerifiedUser(
  ctx: QueryCtx,
  address: string,
  passphrase: string
): Promise<Doc<'users'> | null> {
  const matches = (
    await ctx.db
      .query('users')
      .withIndex('by_stellar_address', (q) => q.eq('stellarAddress', address))
      .take(50)
  ).filter((user) => isStellarAddressVerified(user, passphrase))
  return matches.length === 1 ? matches[0]! : null
}

export async function insertTabAccount(
  ctx: MutationCtx,
  args: {
    network: 'TESTNET' | 'MAINNET'
    chainEpoch: string
    userId: Id<'users'>
    readerAddress: string
    tabContractId: string
    now: number
  }
): Promise<Doc<'tabAccounts'>> {
  const id = await ctx.db.insert('tabAccounts', {
    network: args.network,
    chainEpoch: args.chainEpoch,
    userId: args.userId,
    readerAddress: args.readerAddress,
    tabContractId: args.tabContractId,
    status: 'OPEN',
    confirmedBalance: '0',
    outstanding: '0',
    acceptedToday: '0',
    acceptedDay: utcDay(args.now),
    settledSinceBalance: [],
    pendingKeys: [],
    createdAt: args.now,
    updatedAt: args.now,
  })
  return (await ctx.db.get(id))!
}

// ---------------------------------------------------------------------------
// Eligibility (I-22)

type TipCheckArgs = {
  userId: Id<'users'>
  articleId: Id<'articles'>
  keyId: number
  amount: bigint
  now: number
  env?: EnvLike
}

export type TipCheck = {
  chain: TabChain
  user: Doc<'users'>
  readerAddress: string
  account: Doc<'tabAccounts'>
  key: Doc<'tabSessionKeys'> & { publicKey: string }
  article: Doc<'articles'>
  chainArticle: Doc<'chainArticles'>
  author: Doc<'users'>
  writerAddress: string
  voucher: Doc<'tabVouchers'> | null
  seq: number
  cumulativeBefore: bigint
  minTip: bigint
  acceptedToday: bigint
}

/**
 * Every acceptance rule except the signature. Prepare and submit both call
 * it; submit calls it again inside the accepting mutation.
 */
export async function checkTabTip(
  ctx: QueryCtx,
  args: TipCheckArgs
): Promise<TipCheck> {
  const chain = requireTabChain(args.env)
  const config = await ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (!config || config.chainEpoch !== chain.chainEpoch || !config.minTip) {
    tabError('CHAIN_CONFIG_MISSING', 'The chain configuration is not loaded.')
  }
  const minTip = BigInt(config.minTip)
  const limits = tabLimits(args.env)

  const user = await ctx.db.get(args.userId)
  const readerAddress = verifiedStellarAddress(user, chain.passphrase)
  if (!user || !readerAddress) {
    tabError('TAB_READER_UNVERIFIED', 'Verify your Stellar wallet first.')
  }

  const account = await tabAccountForReader(
    ctx,
    readerAddress,
    chain.chainEpoch
  )
  if (!account || account.userId !== user._id) {
    tabError('TAB_NO_ACCOUNT', 'Open a tab first.')
  }
  if (account.status !== 'OPEN') {
    tabError(
      account.status === 'CLOSING' ? 'TAB_CLOSING' : 'TAB_CLOSED',
      'This tab is closing and accepts no new tips.'
    )
  }
  // The voucher binds the Tab contract. The reader's balance lives in the
  // account's contract, so a voucher for any other contract could never settle.
  if (
    account.tabContractId !== chain.tabContractId ||
    (config.tabContractId !== undefined &&
      config.tabContractId !== chain.tabContractId)
  ) {
    tabError(
      'TAB_CONTRACT_MISMATCH',
      'The tab contract changed. Tips are paused until the tab ledger is reset.'
    )
  }

  const article = await ctx.db.get(args.articleId)
  if (!article) tabError('TAB_ARTICLE_UNKNOWN', 'Article not found.')
  const chainArticle = (
    await ctx.db
      .query('chainArticles')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .take(20)
  ).find((row) => row.chainEpoch === chain.chainEpoch)
  if (!chainArticle || chainArticle.status !== 'REGISTERED') {
    tabError(
      'TAB_ARTICLE_NOT_REGISTERED',
      'Tips are not enabled for this article.'
    )
  }
  const writerAddress = chainArticle.authorAddress
  if (article.authorId === user._id || writerAddress === readerAddress) {
    tabError('TAB_SELF_TIP', 'You cannot tip your own article.')
  }
  if (
    chainArticle.splits.length > 1 ||
    chainArticle.splits.some((s) => s.recipient !== writerAddress)
  ) {
    tabError(
      'TAB_ARTICLE_HAS_SPLITS',
      'This article pays several recipients. Use a direct tip instead.'
    )
  }
  const author = await ctx.db.get(article.authorId)
  if (
    !author ||
    verifiedStellarAddress(author, chain.passphrase) !== writerAddress
  ) {
    tabError(
      'TAB_WRITER_UNVERIFIED',
      "The writer's payout address is not verified."
    )
  }

  const key = await tabKey(ctx, account._id, args.keyId)
  if (!key || !key.publicKey) {
    tabError('TAB_KEY_UNKNOWN', 'This session key is not registered.')
  }
  if (key.revoked) tabError('TAB_KEY_REVOKED', 'This session key is revoked.')
  const ledger = await currentLedgerEstimate(ctx, chain, args.now)
  if (ledger + ACCEPT_MARGIN_LEDGERS >= key.validUntilLedger) {
    tabError(
      'TAB_KEY_EXPIRED',
      'This session key has expired. Register a new key.'
    )
  }

  if (args.amount < minTip) {
    tabError('TAB_BELOW_MINIMUM', 'The tip is below the minimum.')
  }
  if (args.amount > limits.tipMax) {
    tabError('TAB_ABOVE_TIP_MAX', 'The tip is above the tab tip maximum.')
  }
  const acceptedToday =
    account.acceptedDay === utcDay(args.now) ? big(account.acceptedToday) : ZERO
  if (acceptedToday + args.amount > limits.dailyLimit) {
    tabError('TAB_DAILY_LIMIT', 'The daily tab limit is reached.')
  }

  const voucher = await tabVoucher(ctx, account._id, args.keyId, writerAddress)
  if (voucher && voucher.state !== 'ACTIVE') {
    tabError('TAB_PAIR_CLOSED', 'This key can no longer tip this writer.')
  }
  const seq = (voucher?.seq ?? 0) + 1
  if (seq > MAX_RECEIPTS_PER_PAIR) {
    tabError('TAB_RECEIPT_CAP', 'Register a new session key to keep tipping.')
  }
  if (big(account.outstanding) + args.amount > big(account.confirmedBalance)) {
    tabError('TAB_OVER_BALANCE', 'The tab balance is too low. Top up first.')
  }
  if (big(key.acceptedTotal) + args.amount > big(key.spendLimit)) {
    tabError('TAB_OVER_KEY_LIMIT', "The session key's spend limit is reached.")
  }

  return {
    chain,
    user,
    readerAddress,
    account,
    key: key as TipCheck['key'],
    article,
    chainArticle,
    author,
    writerAddress,
    voucher,
    seq,
    cumulativeBefore: voucher ? big(voucher.cumulative) : ZERO,
    minTip,
    acceptedToday,
  }
}

// ---------------------------------------------------------------------------
// Prepare (5.6 step 1)

export type HighlightInput = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type PreparedTabTip = {
  prepareId: Id<'tips'> | Id<'highlightTips'>
  tabContractId: string
  readerAddress: string
  writer: string
  keyId: number
  seq: number
  cumulativeBefore: string
  amount: string
  receipt: StoredReceipt
  /** Leaf hashes of seq 1 to `seq − 1`, in order. */
  leafHashes: string[]
  /** Unix ms; submit before this. */
  expiresAt: number
  existing: boolean
}

function validRequestId(requestId: string): boolean {
  return (
    requestId.length > 0 &&
    requestId.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(requestId)
  )
}

/** Base units for a USD cent amount at `priceUsd` per XLM (rounded down). */
export function centsToStroops(amountCents: number, priceUsd: number): bigint {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents < 1 ||
    amountCents > 1_000_000
  ) {
    tabError('TAB_INVALID_AMOUNT', 'Invalid tip amount.')
  }
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) {
    tabError('TAB_PRICE_UNAVAILABLE', 'No XLM price is available.')
  }
  return BigInt(Math.floor((amountCents * STROOPS_PER_XLM) / (priceUsd * 100)))
}

type TipRow = Doc<'tips'> | Doc<'highlightTips'>

function expectedReceipt(row: TipRow): StoredReceipt {
  const prep = row.tabPrepare!
  return {
    amount: row.grossBaseUnits!,
    articleId: row.chainArticleKey!,
    clientRef: row.clientRef!,
    contentHash: prep.contentHash,
    cumulativeAfter: (
      big(prep.cumulativeBefore) + big(row.grossBaseUnits!)
    ).toString(),
    highlightId: row.chainHighlightKey ?? null,
    seq: prep.seq,
  }
}

async function prepareResponse(
  ctx: QueryCtx,
  row: TipRow,
  existing: boolean
): Promise<PreparedTabTip> {
  const prep = row.tabPrepare!
  const account = await ctx.db.get(prep.tabAccountId)
  const voucher = account
    ? await tabVoucher(ctx, account._id, prep.keyId, row.expectedAuthorAddress!)
    : null
  return {
    prepareId: row._id,
    tabContractId: account?.tabContractId ?? '',
    readerAddress: row.expectedTipperAddress!,
    writer: row.expectedAuthorAddress!,
    keyId: prep.keyId,
    seq: prep.seq,
    cumulativeBefore: prep.cumulativeBefore,
    amount: row.grossBaseUnits!,
    receipt: expectedReceipt(row),
    // Leaf hashes only ever grow, so the prefix stays valid.
    leafHashes: (voucher?.leafHashes ?? []).slice(0, prep.seq - 1),
    expiresAt: row.createdAt + TAB_PREPARE_TTL_MS,
    existing,
  }
}

async function tipRowByRequest(
  ctx: QueryCtx,
  requestId: string
): Promise<TipRow | null> {
  const tip = await ctx.db
    .query('tips')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .first()
  if (tip) return tip
  return ctx.db
    .query('highlightTips')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .first()
}

export async function prepareTabTip(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    requestId: string
    articleId: Id<'articles'>
    keyId: number
    amountCents: number
    highlight?: HighlightInput | null
    now: number
    env?: EnvLike
  }
): Promise<PreparedTabTip> {
  if (!validRequestId(args.requestId)) {
    tabError(
      'INVALID_PREPARE',
      'requestId must be 1 to 100 letters, digits, "-" or "_".'
    )
  }
  if (
    !Number.isInteger(args.keyId) ||
    args.keyId < 0 ||
    args.keyId > 0xffffffff
  ) {
    tabError('INVALID_PREPARE', 'Invalid key id.')
  }
  const existing = await tipRowByRequest(ctx, args.requestId)
  if (existing) {
    if (
      existing.tipperId !== args.userId ||
      existing.channel !== 'tab' ||
      !existing.tabPrepare
    ) {
      tabError('INVALID_PREPARE', 'requestId belongs to another request.')
    }
    return prepareResponse(ctx, existing, true)
  }

  const price = await ctx.db.query('xlmPriceCache').first()
  if (!price || args.now - price.fetchedAt > TAB_PRICE_MAX_AGE_MS) {
    tabError('TAB_PRICE_UNAVAILABLE', 'No current XLM price is available.')
  }
  const amount = centsToStroops(args.amountCents, price.priceUsd)
  const check = await checkTabTip(ctx, {
    userId: args.userId,
    articleId: args.articleId,
    keyId: args.keyId,
    amount,
    now: args.now,
    env: args.env,
  })

  const clientRef = newClientRefHex()
  const tabPrepare = {
    tabAccountId: check.account._id,
    keyId: args.keyId,
    seq: check.seq,
    cumulativeBefore: check.cumulativeBefore.toString(),
    contentHash: check.chainArticle.contentHash,
  }
  const common = {
    articleId: check.article._id,
    tipperId: check.user._id,
    authorId: check.article.authorId,
    articleTitle: check.article.title,
    articleSlug: check.article.slug,
    tipperName: check.user.name || check.user.username,
    tipperAvatar: check.user.avatar,
    authorName: check.author.name || check.author.username,
    authorAvatar: check.author.avatar,
    amountUsd: args.amountCents / 100,
    amountCents: args.amountCents,
    quotePriceUsd: price.priceUsd,
    quoteSource: price.source,
    quoteFetchedAt: price.fetchedAt,
    status: 'PREPARED',
    contractVersion: 'v2' as const,
    channel: 'tab' as const,
    clientRef,
    tokenContractId: check.chain.tokenContractId,
    grossBaseUnits: amount.toString(),
    chainArticleKey: check.chainArticle.articleKey,
    expectedTipperAddress: check.readerAddress,
    expectedAuthorAddress: check.writerAddress,
    requestId: args.requestId,
    chainEpoch: check.chain.chainEpoch,
    stellarNetwork: check.chain.network,
    maxTime: Math.floor((args.now + TAB_PREPARE_TTL_MS) / 1000),
    tabPrepare,
    createdAt: args.now,
    updatedAt: args.now,
  }

  let rowId: Id<'tips'> | Id<'highlightTips'>
  if (args.highlight) {
    const h = args.highlight
    if (
      !Number.isSafeInteger(h.startOffset) ||
      !Number.isSafeInteger(h.endOffset) ||
      h.startOffset < 0 ||
      h.endOffset <= h.startOffset ||
      h.text.length === 0 ||
      h.text.length > 5000
    ) {
      tabError('INVALID_PREPARE', 'Invalid highlight.')
    }
    const highlightKey = await highlightIdHex(
      `${check.article.slug}:${h.startOffset}:${h.endOffset}:${h.text.slice(0, 50)}`
    )
    rowId = await ctx.db.insert('highlightTips', {
      ...common,
      highlightId: highlightKey.slice(0, 28),
      highlightText: h.text,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      ...(h.startContainerPath
        ? { startContainerPath: h.startContainerPath }
        : {}),
      ...(h.endContainerPath ? { endContainerPath: h.endContainerPath } : {}),
      chainHighlightKey: highlightKey,
    })
  } else {
    rowId = await ctx.db.insert('tips', common)
  }
  return prepareResponse(ctx, (await ctx.db.get(rowId))!, false)
}

// ---------------------------------------------------------------------------
// Submit (5.6 step 3)

export type AcceptedVoucher = {
  tabContractId: string
  reader: string
  writer: string
  keyId: number
  publicKey: string
  cumulative: string
  receiptsRoot: string
  signature: string
  acceptor: string
  acceptanceSignature: string
}

export type SubmittedTabTip = {
  status: 'ACCEPTED'
  receiptId: Id<'tabReceipts'>
  receipt: StoredReceipt
  leafHashes: string[]
  voucher: AcceptedVoucher
  /** True when an earlier identical submit accepted it. */
  alreadyAccepted: boolean
}

function sameReceipt(a: StoredReceipt, b: StoredReceipt): boolean {
  return (
    a.amount === b.amount &&
    a.articleId === b.articleId &&
    a.clientRef === b.clientRef &&
    a.contentHash === b.contentHash &&
    a.cumulativeAfter === b.cumulativeAfter &&
    (a.highlightId ?? null) === (b.highlightId ?? null) &&
    a.seq === b.seq
  )
}

function storedReceiptOf(r: Doc<'tabReceipts'>): StoredReceipt {
  return {
    amount: r.amount,
    articleId: r.articleKey,
    clientRef: r.clientRef,
    contentHash: r.contentHash,
    cumulativeAfter: r.cumulativeAfter,
    highlightId: r.highlightId ?? null,
    seq: r.seq,
  }
}

async function replayAccepted(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>
): Promise<SubmittedTabTip> {
  const account = await ctx.db.get(receipt.tabAccountId)
  const key = await tabKey(ctx, receipt.tabAccountId, receipt.keyId)
  const leaves = (await pairReceipts(ctx, receipt))
    .filter((r) => r.seq <= receipt.seq)
    .map((r) => r.leafHash)
  return {
    status: 'ACCEPTED',
    receiptId: receipt._id,
    receipt: storedReceiptOf(receipt),
    leafHashes: leaves,
    voucher: {
      tabContractId: account?.tabContractId ?? '',
      reader: account?.readerAddress ?? '',
      writer: receipt.writerAddress,
      keyId: receipt.keyId,
      publicKey: key?.publicKey ?? '',
      cumulative: receipt.cumulativeAfter,
      receiptsRoot: receipt.receiptsRoot,
      signature: receipt.voucherSignature,
      acceptor: receipt.acceptorPublicKey,
      acceptanceSignature: receipt.acceptanceSignature,
    },
    alreadyAccepted: true,
  }
}

function isReceiptShape(value: unknown): value is StoredReceipt {
  const r = value as StoredReceipt
  return (
    !!r &&
    typeof r.amount === 'string' &&
    typeof r.articleId === 'string' &&
    typeof r.clientRef === 'string' &&
    typeof r.contentHash === 'string' &&
    typeof r.cumulativeAfter === 'string' &&
    (r.highlightId === null || typeof r.highlightId === 'string') &&
    typeof r.seq === 'number'
  )
}

export async function submitTabTip(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    prepareId: Id<'tips'> | Id<'highlightTips'>
    receipt: StoredReceipt
    signature: string
    now: number
    env?: EnvLike
  }
): Promise<SubmittedTabTip> {
  const row = (await ctx.db.get(args.prepareId)) as TipRow | null
  if (
    !row ||
    row.tipperId !== args.userId ||
    row.channel !== 'tab' ||
    !row.tabPrepare
  ) {
    tabError('TAB_PREPARE_NOT_FOUND', 'Prepared tip not found.')
  }
  const signature = args.signature.toLowerCase()
  if (!isHexOfLength(signature, 64)) {
    tabError('TAB_INVALID_SIGNATURE', 'The voucher signature is malformed.')
  }

  // Idempotency on the client reference: the same submit returns the same
  // acceptance; any other voucher for an accepted reference is refused.
  const accepted = await ctx.db
    .query('tabReceipts')
    .withIndex('by_client_ref', (q) => q.eq('clientRef', row.clientRef!))
    .first()
  if (accepted) {
    if (
      accepted.tipRowId === row._id &&
      accepted.voucherSignature === signature &&
      isReceiptShape(args.receipt) &&
      sameReceipt(args.receipt, storedReceiptOf(accepted))
    ) {
      return replayAccepted(ctx, accepted)
    }
    tabError('TAB_DUPLICATE_REFERENCE', 'This tip was already accepted.')
  }
  if (row.status !== 'PREPARED') {
    tabError('TAB_PREPARE_NOT_FOUND', 'Prepared tip not found.')
  }
  if (args.now > row.createdAt + TAB_PREPARE_TTL_MS) {
    tabError(
      'TAB_PREPARE_EXPIRED',
      'The prepared tip expired. Prepare it again.'
    )
  }

  const receipt = expectedReceipt(row)
  if (!isReceiptShape(args.receipt) || !sameReceipt(args.receipt, receipt)) {
    tabError(
      'TAB_RECEIPT_MISMATCH',
      'The receipt differs from the prepared tip.'
    )
  }
  const amount = big(receipt.amount)
  const prep = row.tabPrepare
  const check = await checkTabTip(ctx, {
    userId: args.userId,
    articleId: row.articleId,
    keyId: prep.keyId,
    amount,
    now: args.now,
    env: args.env,
  })
  if (
    check.account._id !== prep.tabAccountId ||
    check.writerAddress !== row.expectedAuthorAddress ||
    check.readerAddress !== row.expectedTipperAddress ||
    check.chainArticle.articleKey !== row.chainArticleKey ||
    check.chainArticle.contentHash !== prep.contentHash ||
    check.seq !== prep.seq ||
    check.cumulativeBefore !== big(prep.cumulativeBefore)
  ) {
    tabError(
      'TAB_STALE_PREPARE',
      'The tab changed since prepare. Prepare again.'
    )
  }

  const leafHash = receiptLeafHex(receipt)
  const leafHashes = [...(check.voucher?.leafHashes ?? []), leafHash]
  const receiptsRoot = receiptsRootHex(leafHashes)
  const cumulative = big(receipt.cumulativeAfter)
  const payload = voucherPayloadBytes({
    tab: check.chain.tabContractId,
    networkId: networkIdOf(check.chain.passphrase),
    reader: check.readerAddress,
    writer: check.writerAddress,
    keyId: prep.keyId,
    publicKey: hexToBytes(check.key.publicKey),
    cumulative,
    receiptsRoot: hexToBytes(receiptsRoot),
  })
  if (!verifyEd25519(check.key.publicKey, payload, signature)) {
    tabError('TAB_INVALID_SIGNATURE', 'The voucher signature is not valid.')
  }
  const acceptor = loadAcceptor(args.env)
  const acceptanceSignature = acceptor.sign(payload)
  const now = args.now

  const receiptId = await ctx.db.insert('tabReceipts', {
    network: check.chain.network,
    chainEpoch: check.chain.chainEpoch,
    tabAccountId: check.account._id,
    keyId: prep.keyId,
    writerAddress: check.writerAddress,
    authorId: check.article.authorId,
    articleId: check.article._id,
    articleKey: receipt.articleId,
    ...(receipt.highlightId ? { highlightId: receipt.highlightId } : {}),
    seq: receipt.seq,
    amount: receipt.amount,
    cumulativeAfter: receipt.cumulativeAfter,
    clientRef: receipt.clientRef,
    contentHash: receipt.contentHash,
    leafHash,
    tipRowId: row._id,
    status: 'ACCEPTED',
    receiptsRoot,
    voucherSignature: signature,
    acceptorPublicKey: acceptor.publicKey,
    acceptanceSignature,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  const voucherFields = {
    cumulative: cumulative.toString(),
    receiptsRoot,
    leafHashes,
    signature,
    acceptance: {
      acceptor: acceptor.publicKey,
      signature: acceptanceSignature,
    },
    seq: receipt.seq,
    acceptedAt: now,
    updatedAt: now,
  }
  let voucherId: Id<'tabVouchers'>
  if (check.voucher) {
    voucherId = check.voucher._id
    const paid = big(check.voucher.paidOnChain)
    await ctx.db.patch(voucherId, {
      ...voucherFields,
      unsettled: paid < cumulative,
      oldestUnsettledAt: check.voucher.oldestUnsettledAt ?? now,
    })
  } else {
    voucherId = await ctx.db.insert('tabVouchers', {
      network: check.chain.network,
      chainEpoch: check.chain.chainEpoch,
      tabAccountId: check.account._id,
      tabContractId: check.chain.tabContractId,
      tokenContractId: check.chain.tokenContractId,
      readerAddress: check.readerAddress,
      keyId: prep.keyId,
      writerAddress: check.writerAddress,
      authorId: check.article.authorId,
      ...voucherFields,
      paidOnChain: '0',
      unsettled: true,
      oldestUnsettledAt: now,
      state: 'ACTIVE',
      earnedNet: '0',
      pendingNet: '0',
    })
  }

  await ctx.db.patch(check.key._id, {
    acceptedTotal: (big(check.key.acceptedTotal) + amount).toString(),
    updatedAt: now,
  })
  await ctx.db.patch(check.account._id, {
    outstanding: (big(check.account.outstanding) + amount).toString(),
    acceptedToday: (check.acceptedToday + amount).toString(),
    acceptedDay: utcDay(now),
    updatedAt: now,
  })
  await patchTipRow(ctx, row._id, {
    status: 'ACCEPTED',
    tabReceiptId: receiptId,
    updatedAt: now,
  })
  await recomputePairEarnings(ctx, voucherId, now)

  return {
    status: 'ACCEPTED',
    receiptId,
    receipt,
    leafHashes,
    voucher: {
      tabContractId: check.chain.tabContractId,
      reader: check.readerAddress,
      writer: check.writerAddress,
      keyId: prep.keyId,
      publicKey: check.key.publicKey,
      cumulative: cumulative.toString(),
      receiptsRoot,
      signature,
      acceptor: acceptor.publicKey,
      acceptanceSignature,
    },
    alreadyAccepted: false,
  }
}

async function patchTipRow(
  ctx: MutationCtx,
  id: Id<'tips'> | Id<'highlightTips'>,
  patch: Partial<Doc<'tips'>> & Partial<Doc<'highlightTips'>>
): Promise<void> {
  const tipsId = ctx.db.normalizeId('tips', id)
  if (tipsId) await ctx.db.patch(tipsId, patch as Partial<Doc<'tips'>>)
  else {
    await ctx.db.patch(
      id as Id<'highlightTips'>,
      patch as Partial<Doc<'highlightTips'>>
    )
  }
}

// ---------------------------------------------------------------------------
// Earnings (section 6.2)

function addToRecord(
  record: Record<string, string> | undefined,
  token: string,
  delta: bigint
): Record<string, string> {
  const current = record?.[token] ? big(record[token]) : ZERO
  return { ...record, [token]: (current + delta).toString() }
}

/** Adds base-unit deltas to a user's `authorEarnings` row. */
export async function adjustBaseUnitEarnings(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    token: string
    earned?: bigint
    pending?: bigint
    collected?: bigint
    now: number
  }
): Promise<void> {
  const earned = args.earned ?? ZERO
  const pending = args.pending ?? ZERO
  const collected = args.collected ?? ZERO
  if (earned === ZERO && pending === ZERO && collected === ZERO) return
  const row = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', args.userId))
    .first()
  if (!row) {
    await ctx.db.insert('authorEarnings', {
      userId: args.userId,
      totalEarnedUsd: 0,
      totalEarnedCents: 0,
      availableBalanceUsd: 0,
      availableBalanceCents: 0,
      pendingBalanceUsd: 0,
      pendingBalanceCents: 0,
      withdrawnUsd: 0,
      withdrawnCents: 0,
      tipCount: 0,
      ...(earned !== ZERO
        ? { earnedBaseUnits: { [args.token]: earned.toString() } }
        : {}),
      ...(pending !== ZERO
        ? { pendingBaseUnits: { [args.token]: pending.toString() } }
        : {}),
      ...(collected !== ZERO
        ? { collectedBaseUnits: { [args.token]: collected.toString() } }
        : {}),
      createdAt: args.now,
      updatedAt: args.now,
    })
    return
  }
  await ctx.db.patch(row._id, {
    ...(earned !== ZERO
      ? {
          earnedBaseUnits: addToRecord(row.earnedBaseUnits, args.token, earned),
        }
      : {}),
    ...(pending !== ZERO
      ? {
          pendingBaseUnits: addToRecord(
            row.pendingBaseUnits,
            args.token,
            pending
          ),
        }
      : {}),
    ...(collected !== ZERO
      ? {
          collectedBaseUnits: addToRecord(
            row.collectedBaseUnits,
            args.token,
            collected
          ),
        }
      : {}),
    updatedAt: args.now,
  })
}

/** The pair's earned and pending net, from the cumulative formulas. */
export function pairFigures(
  v: Pick<Doc<'tabVouchers'>, 'paidOnChain' | 'cumulative' | 'state'>
) {
  const paid = big(v.paidOnChain)
  const earned = netOf(paid)
  const pending =
    v.state === 'ACTIVE'
      ? netOf(maxBig(big(v.cumulative), paid)) - earned
      : ZERO
  return { earned, pending }
}

/**
 * Recomputes the pair's figures and applies the difference to the writer's
 * `authorEarnings`, so repeated calls are idempotent.
 */
export async function recomputePairEarnings(
  ctx: MutationCtx,
  voucherId: Id<'tabVouchers'>,
  now: number
): Promise<void> {
  const voucher = await ctx.db.get(voucherId)
  if (!voucher) return
  const { earned, pending } = pairFigures(voucher)
  const dEarned = earned - big(voucher.earnedNet)
  const dPending = pending - big(voucher.pendingNet)
  if (dEarned === ZERO && dPending === ZERO) return
  await ctx.db.patch(voucherId, {
    earnedNet: earned.toString(),
    pendingNet: pending.toString(),
  })
  await adjustBaseUnitEarnings(ctx, {
    userId: voucher.authorId,
    token: voucher.tokenContractId,
    earned: dEarned,
    pending: dPending,
    now,
  })
}

// ---------------------------------------------------------------------------
// Receipt states

/** The writer's net for one receipt under the cumulative fee rule. */
export function receiptNet(
  r: Pick<Doc<'tabReceipts'>, 'amount' | 'cumulativeAfter'>
) {
  const after = big(r.cumulativeAfter)
  return netOf(after) - netOf(after - big(r.amount))
}

async function setReceiptStatus(
  ctx: MutationCtx,
  receipt: Doc<'tabReceipts'>,
  status: TabReceiptStatus,
  now: number,
  extra: Partial<Doc<'tabReceipts'>> = {}
): Promise<void> {
  if (receipt.status === status) return
  await ctx.db.patch(receipt._id, { status, updatedAt: now, ...extra })
  const row = (await ctx.db.get(receipt.tipRowId)) as TipRow | null
  if (!row) return
  if (status === 'SETTLED' && row.earningsAppliedAt === undefined) {
    // Display figures only; base-unit earnings come from the pair formulas.
    const net = receiptNet(receipt)
    const gross = big(receipt.amount)
    const cents =
      gross > ZERO
        ? roundCents(
            row.amountCents *
              (Number((net * BigInt(1_000_000)) / gross) / 1_000_000)
          )
        : 0
    await creditAuthorEarnings(ctx, {
      authorId: receipt.authorId,
      articleId: receipt.articleId,
      articleTitle: row.articleTitle,
      shareCents: cents,
      now,
    })
    await patchTipRow(ctx, row._id, {
      status,
      grossBaseUnits: receipt.amount,
      netBaseUnits: net.toString(),
      feeBaseUnits: (gross - net).toString(),
      earningsAppliedAt: now,
      updatedAt: now,
    })
    return
  }
  await patchTipRow(ctx, row._id, { status, updatedAt: now })
}

/**
 * Applies the pair's paid amount to its receipts: `cumulative_after ≤ paid`
 * becomes `SETTLED`; accepted receipts up to `shortfallUpTo` that stay unpaid
 * become `SHORTFALL`. Then refreshes the pair's unsettled flags.
 */
export async function applyPairPayment(
  ctx: MutationCtx,
  voucherId: Id<'tabVouchers'>,
  args: { shortfallUpTo?: bigint; settledEventId?: string; now: number }
): Promise<void> {
  const voucher = (await ctx.db.get(voucherId))!
  const paid = big(voucher.paidOnChain)
  let oldestUnsettledAt: number | undefined
  for (const receipt of await pairReceipts(ctx, voucher)) {
    const after = big(receipt.cumulativeAfter)
    const live = receipt.status === 'ACCEPTED' || receipt.status === 'SHORTFALL'
    if (live && after <= paid) {
      await setReceiptStatus(ctx, receipt, 'SETTLED', args.now, {
        ...(args.settledEventId ? { settledEventId: args.settledEventId } : {}),
      })
      continue
    }
    if (
      receipt.status === 'ACCEPTED' &&
      args.shortfallUpTo !== undefined &&
      after <= args.shortfallUpTo
    ) {
      await setReceiptStatus(ctx, receipt, 'SHORTFALL', args.now)
    }
    if (
      live &&
      (oldestUnsettledAt === undefined ||
        receipt.acceptedAt < oldestUnsettledAt)
    ) {
      oldestUnsettledAt = receipt.acceptedAt
    }
  }
  const unsettled = voucher.state === 'ACTIVE' && paid < big(voucher.cumulative)
  await ctx.db.patch(voucherId, {
    unsettled,
    oldestUnsettledAt: unsettled ? oldestUnsettledAt : undefined,
    updatedAt: args.now,
  })
}

/** Accepted amount of a pair that is still owed: `max(0, cumulative − paid)`. */
export function pairOutstanding(
  v: Pick<Doc<'tabVouchers'>, 'cumulative' | 'paidOnChain'>
) {
  const owed = big(v.cumulative) - big(v.paidOnChain)
  return owed > ZERO ? owed : ZERO
}

async function closePair(
  ctx: MutationCtx,
  voucher: Doc<'tabVouchers'>,
  state: 'UNPAID' | 'VOID_RESET',
  now: number
): Promise<void> {
  if (voucher.state !== 'ACTIVE') return
  const paid = big(voucher.paidOnChain)
  for (const receipt of await pairReceipts(ctx, voucher)) {
    const live = receipt.status === 'ACCEPTED' || receipt.status === 'SHORTFALL'
    if (live && big(receipt.cumulativeAfter) > paid) {
      await setReceiptStatus(ctx, receipt, state, now)
    }
  }
  const owed = pairOutstanding(voucher)
  await ctx.db.patch(voucher._id, {
    state,
    unsettled: false,
    oldestUnsettledAt: undefined,
    updatedAt: now,
  })
  const account = await ctx.db.get(voucher.tabAccountId)
  if (account && owed > ZERO) {
    const outstanding = big(account.outstanding) - owed
    await ctx.db.patch(account._id, {
      outstanding: (outstanding > ZERO ? outstanding : ZERO).toString(),
      updatedAt: now,
    })
  }
  await recomputePairEarnings(ctx, voucher._id, now)
}

/**
 * `UNPAID` (section 6.1): once the account is `CLOSED` and a key's settle
 * window (`valid_until + SETTLE_GRACE`) has ended, receipts above the paid
 * amount can never settle. Returns the number of pairs closed.
 */
export async function resolveUnpaidPairs(
  ctx: MutationCtx,
  accountId: Id<'tabAccounts'>,
  ledger: number,
  now: number
): Promise<number> {
  const account = await ctx.db.get(accountId)
  if (!account || account.status !== 'CLOSED') return 0
  const keys = await ctx.db
    .query('tabSessionKeys')
    .withIndex('by_account_key', (q) => q.eq('tabAccountId', accountId))
    .take(1000)
  let closed = 0
  for (const key of keys) {
    if (ledger <= key.validUntilLedger + SETTLE_GRACE_LEDGERS) continue
    const vouchers = await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) =>
        q.eq('tabAccountId', accountId).eq('keyId', key.keyId)
      )
      .take(1000)
    for (const voucher of vouchers) {
      if (voucher.state !== 'ACTIVE' || pairOutstanding(voucher) === ZERO)
        continue
      await closePair(ctx, voucher, 'UNPAID', now)
      closed++
    }
  }
  return closed
}

/**
 * `VOID_RESET` (section 7.4, testnet reset): unsettled pairs of a closed
 * chain epoch. Bounded per call; returns whether more may remain.
 */
export async function voidEpochPairs(
  ctx: MutationCtx,
  args: { chainEpoch: string; limit: number; now: number }
): Promise<{ voided: number; more: boolean }> {
  const vouchers = await ctx.db
    .query('tabVouchers')
    .withIndex('by_epoch_state', (q) =>
      q.eq('chainEpoch', args.chainEpoch).eq('state', 'ACTIVE')
    )
    .take(args.limit)
  let voided = 0
  for (const voucher of vouchers) {
    await closePair(ctx, voucher, 'VOID_RESET', args.now)
    voided++
  }
  return { voided, more: vouchers.length === args.limit }
}

// ---------------------------------------------------------------------------
// Settlement inputs (for the settler, #465)

/** A voucher in the shape `Tab.settle` and `settle_own` take, hex-encoded. */
export function settlementVoucher(
  voucher: Doc<'tabVouchers'>,
  publicKey: string | undefined
): AcceptedVoucher {
  return {
    tabContractId: voucher.tabContractId,
    reader: voucher.readerAddress,
    writer: voucher.writerAddress,
    keyId: voucher.keyId,
    publicKey: publicKey ?? '',
    cumulative: voucher.cumulative,
    receiptsRoot: voucher.receiptsRoot,
    signature: voucher.signature,
    acceptor: voucher.acceptance.acceptor,
    acceptanceSignature: voucher.acceptance.signature,
  }
}

export function isAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
}
