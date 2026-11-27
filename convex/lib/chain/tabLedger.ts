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
import {
  creditAuthorEarnings,
  newRowTotalsFields,
  tabShareCents,
} from '../authorEarnings'
import {
  creditTabTipTotals,
  notePairEarned,
  tabPaidDelta,
} from '../lifetimeEarnings'
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
  /** Tab `acceptor_keys` from the last config refresh, if read. */
  acceptorKeys: string[] | undefined
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
  if (args.amount > readerSpendable(account)) {
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
    acceptorKeys: config.tabAcceptorKeys,
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

/** The largest US cent amount `centsToStroops` accepts at this price. */
const MAX_TIP_CENTS = 1_000_000

/**
 * The largest whole-cent tip whose base units at `priceUsd` stay within
 * `maxBaseUnits` (the same rounding as `centsToStroops`), or 0 when even one
 * cent is above it. The tip dialog offers no amount above this.
 */
export function maxCentsWithin(maxBaseUnits: bigint, priceUsd: number): number {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return 0
  const fits = (c: number) =>
    BigInt(Math.floor((c * STROOPS_PER_XLM) / (priceUsd * 100))) <= maxBaseUnits
  if (!fits(1)) return 0
  if (fits(MAX_TIP_CENTS)) return MAX_TIP_CENTS
  // `centsToStroops` never decreases as cents grow: search the boundary.
  let low = 1
  let high = MAX_TIP_CENTS
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid)) low = mid
    else high = mid
  }
  return low
}

/**
 * The tab tip limits a reader's next quick tip is checked against, as raw
 * values: nothing here depends on the time, because a subscribed query does
 * not re-run as time passes. The client applies the UTC day and the price's
 * age with its own clock (`lib/tab-ui/tip-limits.ts`) and explains an amount
 * above a limit before it prepares anything.
 */
export type TabTipLimitsView = {
  /** Base units; `TAB_TIP_MAX`. */
  tipMax: string
  /** Base units; `TAB_DAILY_LIMIT`. */
  dailyLimit: string
  /** Base units accepted on `acceptedDay` (UTC `YYYY-MM-DD`). */
  acceptedToday: string
  acceptedDay: string
  /** Base units; the chain minimum, or null before the config is loaded. */
  minTip: string | null
  /** The cached price prepare converts with, or null when there is none. */
  priceUsd: number | null
  /** When that price was fetched; prepare refuses it after `priceMaxAgeMs`. */
  priceFetchedAt: number | null
  priceMaxAgeMs: number
  /** The largest whole-cent tip within `tipMax` at `priceUsd`. */
  tipMaxCents: number | null
}

export async function tabTipLimitsView(
  ctx: QueryCtx,
  args: {
    network: ChainEnv['network']
    chainEpoch: string
    account: Pick<Doc<'tabAccounts'>, 'acceptedDay' | 'acceptedToday'>
    env?: EnvLike
  }
): Promise<TabTipLimitsView | null> {
  let limits: TabLimits
  try {
    limits = tabLimits(args.env)
  } catch {
    return null
  }
  const config = await ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', args.network))
    .first()
  const minTip =
    config && config.chainEpoch === args.chainEpoch && config.minTip
      ? config.minTip
      : null
  const price = await ctx.db.query('xlmPriceCache').first()
  const usable =
    !!price && price.priceUsd > 0 && Number.isFinite(price.priceUsd)
  return {
    tipMax: limits.tipMax.toString(),
    dailyLimit: limits.dailyLimit.toString(),
    acceptedToday: args.account.acceptedToday,
    acceptedDay: args.account.acceptedDay,
    minTip,
    priceUsd: usable ? price.priceUsd : null,
    priceFetchedAt: usable ? price.fetchedAt : null,
    priceMaxAgeMs: TAB_PRICE_MAX_AGE_MS,
    tipMaxCents: usable ? maxCentsWithin(limits.tipMax, price.priceUsd) : null,
  }
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
  // A countersignature from a key the Tab does not list would leave the
  // writer without the `settle_own` recourse.
  if (!check.acceptorKeys?.includes(acceptor.publicKey)) {
    tabError(
      'TAB_ACCEPTOR_MISMATCH',
      'Tab tips are paused while the acceptor key is checked.'
    )
  }
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
    settleBy: check.key.validUntilLedger + SETTLE_GRACE_LEDGERS,
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
    await refreshSettleQueue(ctx, voucherId, now)
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
      settleQueue: 'ready',
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
      ...(await newRowTotalsFields(ctx, args.userId, args.now)),
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
  // A rebuild of the writer's lifetime totals in progress needs the change
  // (#552); the totals themselves count settled receipts, not pair payments.
  if (dEarned !== ZERO) await notePairEarned(ctx, voucher, dEarned)
}

// ---------------------------------------------------------------------------
// Receipt states

/**
 * The writer's net of the part of a receipt that the pair's `paid` amount
 * covers (#552). The receipt spans `cumulativeAfter − amount` to
 * `cumulativeAfter` of the pair's cumulative amount, so over a pair's receipts
 * this sums to `netOf(paid)`; a fully paid receipt gives `receiptNet`.
 */
export function receiptPaidNet(
  r: Pick<Doc<'tabReceipts'>, 'amount' | 'cumulativeAfter'>,
  paid: bigint
): bigint {
  const after = big(r.cumulativeAfter)
  const before = after - big(r.amount)
  if (paid <= before) return ZERO
  return netOf(paid < after ? paid : after) - netOf(before)
}

/**
 * Credits the writers' lifetime tab totals with what each receipt of the pair
 * gained when its paid amount grew from `oldPaid` to `newPaid` (#552). It runs
 * once per paid range, so a replayed or repeated settlement adds nothing.
 */
async function creditTabPaidRange(
  ctx: MutationCtx,
  voucher: Doc<'tabVouchers'>,
  oldPaid: bigint,
  newPaid: bigint
): Promise<void> {
  for (const receipt of await pairReceipts(ctx, voucher)) {
    const before = receiptPaidNet(receipt, oldPaid)
    const after = receiptPaidNet(receipt, newPaid)
    if (after === before) continue
    const row = (await ctx.db.get(receipt.tipRowId)) as TipRow | null
    if (!row) continue
    await creditTabTipTotals(
      ctx,
      receipt.authorId,
      ctx.db.normalizeId('tips', row._id) ? 'tips' : 'highlightTips',
      row,
      tabPaidDelta(
        row.amountCents,
        big(receipt.amount),
        voucher.tokenContractId,
        before,
        after
      )
    )
  }
}

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
    const cents = tabShareCents(row.amountCents, net, gross)
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

/** The settler queue a pair belongs in (see `tabVouchers.settleQueue`). */
export function settleQueueOf(
  v: Pick<
    Doc<'tabVouchers'>,
    'state' | 'paidOnChain' | 'cumulative' | 'settlementId' | 'settleQueue'
  >
): NonNullable<Doc<'tabVouchers'>['settleQueue']> {
  if (v.state !== 'ACTIVE' || big(v.paidOnChain) >= big(v.cumulative)) {
    return 'done'
  }
  if (v.settlementId) return 'inflight'
  return v.settleQueue === 'blocked' ? 'blocked' : 'ready'
}

/**
 * Recomputes `settleQueue`. `block` parks a pair after a `SHORTFALL` skip
 * until the reader deposits; `unblock` releases it.
 */
export async function refreshSettleQueue(
  ctx: MutationCtx,
  voucherId: Id<'tabVouchers'>,
  now: number,
  opts: { block?: boolean; unblock?: boolean } = {}
): Promise<void> {
  const v = await ctx.db.get(voucherId)
  if (!v) return
  const base = opts.unblock
    ? { ...v, settleQueue: 'ready' as const }
    : opts.block
      ? { ...v, settleQueue: 'blocked' as const }
      : v
  const queue = settleQueueOf(base)
  if (queue !== v.settleQueue) {
    await ctx.db.patch(voucherId, { settleQueue: queue, updatedAt: now })
  }
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
  await refreshSettleQueue(ctx, voucherId, args.now)
}

/** Accepted amount of a pair that is still owed: `max(0, cumulative − paid)`. */
export function pairOutstanding(
  v: Pick<Doc<'tabVouchers'>, 'cumulative' | 'paidOnChain'>
) {
  const owed = big(v.cumulative) - big(v.paidOnChain)
  return owed > ZERO ? owed : ZERO
}

export type PaidRange = { from: string; to: string }

/** Adds `[from, to]` to sorted, merged ranges; an overlap counts once. */
export function addPaidRange(
  ranges: readonly PaidRange[],
  from: bigint,
  to: bigint
): PaidRange[] {
  const spans = [
    ...ranges.map((r) => [big(r.from), big(r.to)] as const),
    ...(to > from ? [[from, to] as const] : []),
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const merged: Array<[bigint, bigint]> = []
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) {
      if (b > last[1]) last[1] = b
    } else {
      merged.push([a, b])
    }
  }
  return merged.map(([a, b]) => ({ from: a.toString(), to: b.toString() }))
}

function rangesTotal(ranges: readonly PaidRange[]): bigint {
  return ranges.reduce((sum, r) => sum + big(r.to) - big(r.from), ZERO)
}

/** The pair's indexed ranges; a row without them counts as fully indexed. */
function indexedRangesOf(
  v: Pick<Doc<'tabVouchers'>, 'indexedPaid' | 'paidOnChain'>
): PaidRange[] {
  if (v.indexedPaid) return v.indexedPaid
  return big(v.paidOnChain) > ZERO ? [{ from: '0', to: v.paidOnChain }] : []
}

/**
 * A ledger amount that must not be negative. A negative value means the
 * stored figures disagree; it is logged as `CHAIN_TAB_LEDGER_NEGATIVE` for
 * review and stored as zero, which only ever enlarges the reserve.
 */
function flagNegative(
  value: bigint,
  field: string,
  ids: Record<string, string>
): bigint {
  if (value >= ZERO) return value
  console.error(
    JSON.stringify({
      code: 'CHAIN_TAB_LEDGER_NEGATIVE',
      field,
      value: value.toString(),
      ...ids,
    })
  )
  return ZERO
}

/** Paid per the settler's record, not yet debited by an indexed event. */
function unindexedOf(
  voucherId: Id<'tabVouchers'>,
  paid: bigint,
  ranges: readonly PaidRange[]
): bigint {
  return flagNegative(paid - rangesTotal(ranges), 'pair.unindexed', {
    voucherId,
  })
}

/**
 * What the reader's balance must still cover: accepted and unsettled
 * (`outstanding`), plus settled amounts whose debit the indexer has not
 * applied to `confirmedBalance` yet (`settledUnindexed`).
 */
export function reservedOf(
  account: Pick<Doc<'tabAccounts'>, 'outstanding' | 'settledUnindexed'>
): bigint {
  return big(account.outstanding) + big(account.settledUnindexed ?? '0')
}

/**
 * The reader's spendable tab amount in base units:
 * `confirmedBalance − outstanding − settledUnindexed`.
 *
 * The one definition of the figure. The tab tip check (`TAB_OVER_BALANCE`)
 * and every read model that shows it (`getMyTab.available`) call this, so
 * the screen and the acceptance rule cannot disagree. It is not clamped: a
 * negative result means the tab is over-committed (for example after a
 * withdrawal, before unpaid pairs close) and accepts no tab tip.
 */
export function readerSpendable(
  account: Pick<
    Doc<'tabAccounts'>,
    'confirmedBalance' | 'outstanding' | 'settledUnindexed'
  >
): bigint {
  return big(account.confirmedBalance) - reservedOf(account)
}

/**
 * Applies a settled payment to a pair, from the settler's own transaction
 * result or from an indexed `TabSettled` event (`indexedGross` set): the
 * first to arrive raises `paidOnChain` (it only grows) and moves the paid
 * amount from the account's `outstanding` to `settledUnindexed`. The event
 * debits `confirmedBalance` and clears the same amount from
 * `settledUnindexed`, by paid range, so the order and repetition of the two
 * never change spendable (`confirmedBalance − outstanding − settledUnindexed`).
 */
export async function applyPairSettlement(
  ctx: MutationCtx,
  args: {
    voucherId: Id<'tabVouchers'>
    paidAfter: bigint
    /** The voucher's cumulative amount on chain; above `paidAfter` is a shortfall. */
    cumulative: bigint
    eventId?: string
    /** `TabSettled.gross`: the event's debit, `[paidAfter − gross, paidAfter]`. */
    indexedGross?: bigint
    now: number
  }
): Promise<void> {
  const voucher = await ctx.db.get(args.voucherId)
  if (!voucher) return
  const oldPaid = big(voucher.paidOnChain)
  const newPaid = args.paidAfter > oldPaid ? args.paidAfter : oldPaid
  const oldRanges = indexedRangesOf(voucher)
  const newRanges =
    args.indexedGross !== undefined && args.indexedGross > ZERO
      ? addPaidRange(
          oldRanges,
          args.paidAfter - args.indexedGross,
          args.paidAfter
        )
      : oldRanges
  const unindexedDelta =
    unindexedOf(voucher._id, newPaid, newRanges) -
    unindexedOf(voucher._id, oldPaid, oldRanges)
  const rangesChanged =
    voucher.indexedPaid === undefined ||
    rangesTotal(newRanges) !== rangesTotal(oldRanges)
  if (newPaid > oldPaid || rangesChanged) {
    await ctx.db.patch(voucher._id, {
      ...(newPaid > oldPaid ? { paidOnChain: newPaid.toString() } : {}),
      indexedPaid: newRanges,
      ...(args.eventId &&
      newPaid > oldPaid &&
      (!voucher.lastSettledEventId || voucher.lastSettledEventId < args.eventId)
        ? { lastSettledEventId: args.eventId }
        : {}),
      updatedAt: args.now,
    })
  }
  const account = await ctx.db.get(voucher.tabAccountId)
  if (account) {
    const owedDelta =
      newPaid > oldPaid && voucher.state === 'ACTIVE'
        ? pairOutstanding(voucher) -
          pairOutstanding({
            cumulative: voucher.cumulative,
            paidOnChain: newPaid.toString(),
          })
        : ZERO
    if (owedDelta !== ZERO || unindexedDelta !== ZERO) {
      const ids = { tabAccountId: account._id, voucherId: voucher._id }
      const outstanding = flagNegative(
        big(account.outstanding) - owedDelta,
        'account.outstanding',
        ids
      )
      const unindexed = flagNegative(
        big(account.settledUnindexed ?? '0') + unindexedDelta,
        'account.settledUnindexed',
        ids
      )
      await ctx.db.patch(account._id, {
        outstanding: outstanding.toString(),
        settledUnindexed: unindexed.toString(),
        updatedAt: args.now,
      })
    }
  }
  if (newPaid > oldPaid) {
    const key = await tabKey(ctx, voucher.tabAccountId, voucher.keyId)
    if (key) {
      await ctx.db.patch(key._id, {
        spentOnChain: (big(key.spentOnChain) + newPaid - oldPaid).toString(),
        updatedAt: args.now,
      })
    }
    await creditTabPaidRange(ctx, voucher, oldPaid, newPaid)
  }
  await applyPairPayment(ctx, voucher._id, {
    shortfallUpTo:
      args.paidAfter < args.cumulative ? args.cumulative : undefined,
    ...(args.eventId ? { settledEventId: args.eventId } : {}),
    now: args.now,
  })
  await recomputePairEarnings(ctx, voucher._id, args.now)
}

type ClosedState = 'UNPAID' | 'VOID_RESET' | 'REJECTED'

async function closePair(
  ctx: MutationCtx,
  voucher: Doc<'tabVouchers'>,
  state: ClosedState,
  now: number,
  extra: Partial<Doc<'tabVouchers'>> = {}
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
    ...extra,
    state,
    unsettled: false,
    oldestUnsettledAt: undefined,
    settleQueue: 'done',
    settlementId: undefined,
    updatedAt: now,
  })
  const account = await ctx.db.get(voucher.tabAccountId)
  if (account && owed > ZERO) {
    const outstanding = flagNegative(
      big(account.outstanding) - owed,
      'account.outstanding',
      { tabAccountId: account._id, voucherId: voucher._id }
    )
    await ctx.db.patch(account._id, {
      outstanding: outstanding.toString(),
      updatedAt: now,
    })
  }
  await recomputePairEarnings(ctx, voucher._id, now)
}

/**
 * Excludes a pair whose voucher would abort a settlement (a failing
 * signature check or a simulation error), for review. Its receipts become
 * `REJECTED`, and the reader's reservation is released.
 */
export async function rejectPair(
  ctx: MutationCtx,
  voucherId: Id<'tabVouchers'>,
  reason: string,
  now: number
): Promise<boolean> {
  const voucher = await ctx.db.get(voucherId)
  if (!voucher || voucher.state !== 'ACTIVE') return false
  await closePair(ctx, voucher, 'REJECTED', now, {
    rejectedReason: reason.slice(0, 500),
  })
  return true
}

/** Closes a pair as `UNPAID` (the contract reported its key gone or expired). */
export async function closeUnpaidPair(
  ctx: MutationCtx,
  voucherId: Id<'tabVouchers'>,
  now: number
): Promise<void> {
  const voucher = await ctx.db.get(voucherId)
  if (voucher) await closePair(ctx, voucher, 'UNPAID', now)
}

/**
 * `UNPAID`: once a key's settle window (`valid_until + SETTLE_GRACE`) has
 * ended, receipts above the paid amount can never settle, whatever the
 * account's status. Returns the number of pairs closed.
 */
export async function resolveUnpaidPairs(
  ctx: MutationCtx,
  accountId: Id<'tabAccounts'>,
  ledger: number,
  now: number
): Promise<number> {
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
      if (voucher.state !== 'ACTIVE' || voucher.settlementId) continue
      if (pairOutstanding(voucher) === ZERO) continue
      await closePair(ctx, voucher, 'UNPAID', now)
      closed++
    }
  }
  return closed
}

/**
 * Closes pairs whose settle window ended before `ledger`, oldest window
 * first, through `by_queue_settle_by`. Pairs in a settlement that is still
 * open are left until it finishes. Bounded per call.
 */
export async function sweepExpiredPairs(
  ctx: MutationCtx,
  args: { ledger: number; limit: number; now: number }
): Promise<{ closed: number; more: boolean }> {
  let closed = 0
  let more = false
  for (const queue of ['ready', 'blocked'] as const) {
    const rows = await ctx.db
      .query('tabVouchers')
      .withIndex('by_queue_settle_by', (q) =>
        q.eq('settleQueue', queue).lt('settleBy', args.ledger)
      )
      .take(args.limit)
    if (rows.length === args.limit) more = true
    for (const voucher of rows) {
      await closePair(ctx, voucher, 'UNPAID', args.now)
      closed++
    }
  }
  return { closed, more }
}

/** Keeps `settleBy` in step with the key's `valid_until` (revocation lowers it). */
export async function updateKeySettleBy(
  ctx: MutationCtx,
  accountId: Id<'tabAccounts'>,
  keyId: number,
  validUntilLedger: number,
  now: number
): Promise<void> {
  const settleBy = validUntilLedger + SETTLE_GRACE_LEDGERS
  const vouchers = await ctx.db
    .query('tabVouchers')
    .withIndex('by_pair', (q) =>
      q.eq('tabAccountId', accountId).eq('keyId', keyId)
    )
    .take(1000)
  for (const v of vouchers) {
    if (v.settleBy === undefined || v.settleBy > settleBy) {
      await ctx.db.patch(v._id, { settleBy, updatedAt: now })
    }
  }
}

/** Returns an account's pairs parked after `SHORTFALL` to the ready queue. */
export async function unblockAccountPairs(
  ctx: MutationCtx,
  accountId: Id<'tabAccounts'>,
  now: number
): Promise<void> {
  const vouchers = await ctx.db
    .query('tabVouchers')
    .withIndex('by_pair', (q) => q.eq('tabAccountId', accountId))
    .take(1000)
  for (const v of vouchers) {
    if (v.settleQueue === 'blocked') {
      await refreshSettleQueue(ctx, v._id, now, { unblock: true })
    }
  }
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
