/**
 * Prepare and status rules for v2 direct, highlight and batch tips
 * (docs/architecture/v2/05-flows-and-admin.md, sections 5.2 to 5.4;
 * 06-app-integration.md, sections 6.1 to 6.4; 07-security-and-recovery.md,
 * section 7.3).
 *
 * `convex/tipsV2.ts` exposes these as Convex functions. The rows themselves
 * are created by `prepareTipSubmission`, and only the verifier and the
 * indexer move them to a final state (I-21).
 */
import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { consumeFixedWindow } from '../fixedWindowLimit'
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from '../constants'
import { resolveCanonicalHighlightPassage } from '../tiptapContent'
import { verifiedStellarAddress, walletLinkState } from '../walletVerification'
import { requireChainV2Enabled, type ChainEnv } from './env'
import { FEE_BPS } from './fees'
import { highlightIdHex } from './ids'
import {
  MAX_BATCH_ITEMS,
  loadTipRows,
  prepareTipSubmission,
  type PrepareTipItem,
} from './submissionStore'
import { tipFee } from './verify'

// ---------------------------------------------------------------------------
// Error codes

/**
 * Codes a v2 tip function throws, as `ConvexError` data
 * `{ code, message, ...details }`. The client maps each code to a message.
 */
export const TIP_V2_ERROR_CODES = [
  /** Not signed in. */
  'UNAUTHENTICATED',
  /** Too many prepare calls; `retryAfterMs` says when to try again. */
  'RATE_LIMITED',
  /** `CHAIN_V2_ENABLED` is not `true` on this deployment. */
  'CHAIN_V2_DISABLED',
  /** Contract IDs are unset, or the cached Core config is not loaded. */
  'CHAIN_CONFIG_MISSING',
  /** A configured contract ID is not a contract address. */
  'CHAIN_CONFIG_INVALID',
  /** Malformed request (`requestId`, message length, item shape). */
  'INVALID_PREPARE',
  /** `requestId` was used before for a different request. */
  'REQUEST_CONFLICT',
  /** `amountCents` is not a whole number of cents in the allowed range. */
  'INVALID_AMOUNT',
  /** The article does not exist or is not published. */
  'ARTICLE_NOT_FOUND',
  /** Tips are not enabled: no `REGISTERED` chain record in this epoch. */
  'ARTICLE_NOT_REGISTERED',
  /**
   * The article's on-chain author is not the owner's verified linked
   * address. The UI says "update the article's payout address".
   */
  'PAYOUT_ADDRESS_CHANGED',
  /** The tipper has no linked wallet. */
  'NO_WALLET',
  /** The tipper's linked wallet is not verified on this network. */
  'ADDRESS_UNVERIFIED',
  /** The tipper owns the article, or is its author or a split recipient. */
  'SELF_TIP',
  /** The amount in base units is below Core's `min_tip`. */
  'BELOW_MINIMUM',
  /** Core is paused (cached `chainConfig`). */
  'PAUSED',
  /** No XLM price newer than `PRICE_MAX_AGE_MS` is cached. */
  'PRICE_UNAVAILABLE',
  /** A batch has no items. */
  'BATCH_EMPTY',
  /** More than 10 items, or more than 24 transfers. */
  'BATCH_TOO_LARGE',
  /** The highlight does not match the article's text. */
  'HIGHLIGHT_INVALID',
  /** The submission or tip does not exist or belongs to someone else. */
  'NOT_FOUND',
  /** `recordSubmitted` or `recordSendFailed` in a state that forbids it. */
  'INVALID_STATE',
  /** The transaction hash is not 64 hex characters. */
  'INVALID_TX_HASH',
  /** The transaction hash is recorded on another submission. */
  'DUPLICATE_TX',
] as const

export type TipV2ErrorCode = (typeof TIP_V2_ERROR_CODES)[number]

export type TipV2ErrorData = {
  code: TipV2ErrorCode
  message: string
  /** Batch item the error refers to, from 0. */
  itemIndex?: number
  retryAfterMs?: number
  minTipBaseUnits?: string
  maxItems?: number
  maxTransfers?: number
  transferCount?: number
}

export function tipError(
  code: TipV2ErrorCode,
  message: string,
  details: Omit<TipV2ErrorData, 'code' | 'message'> = {}
): never {
  throw new ConvexError<TipV2ErrorData>({ code, message, ...details })
}

// ---------------------------------------------------------------------------
// Limits and amounts

/** Core caps (02-core-contract.md, section 2.1). */
export { MAX_BATCH_ITEMS }
export const MAX_BATCH_TRANSFERS = 24
/** A cached XLM price older than this is not used to price a tip. */
export const PRICE_MAX_AGE_MS = 30 * 60 * 1000
/** Prepare calls per user per window. A replayed `requestId` is free. */
export const PREPARE_RATE_LIMIT = 10
export const PREPARE_RATE_WINDOW_MS = 60_000
/**
 * `recordSubmitted` and `recordSendFailed` together, per user. A client makes
 * one record call per prepare (at most 10 a minute), so 30 leaves room for
 * retries. Repeating `recordSubmitted` with the stored hash is not counted.
 */
export const RECORD_RATE_LIMIT = 30
export const RECORD_RATE_WINDOW_MS = 60_000
export const MAX_MESSAGE_LENGTH = 500
const MAX_HIGHLIGHT_TEXT = 5_000
const STROOPS_PER_XLM = 10_000_000
const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/

/**
 * Base units for a cent amount at `priceUsd` per XLM, rounded down. The
 * native token has 7 decimals (stroops). Same formula as the tab prepare.
 */
export function centsToBaseUnits(
  amountCents: number,
  priceUsd: number
): bigint {
  return BigInt(Math.floor((amountCents * STROOPS_PER_XLM) / (priceUsd * 100)))
}

/** Smallest whole cent amount whose base units reach `minTip`. */
export function minimumCents(minTip: bigint, priceUsd: number): number {
  let cents = Math.max(
    TIP_MIN_CENTS,
    Math.ceil((Number(minTip) * priceUsd * 100) / STROOPS_PER_XLM)
  )
  // Float rounding can land one cent short; step up until it converts.
  while (centsToBaseUnits(cents, priceUsd) < minTip) cents++
  return cents
}

/** Base units as a decimal XLM string, without trailing zeros. */
export function baseUnitsToXlm(baseUnits: bigint | string): string {
  const padded = BigInt(baseUnits).toString().padStart(8, '0')
  const whole = padded.slice(0, -7)
  const fraction = padded.slice(-7).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** `fee` and `net` of a tip by the 250 bps rule (I-1). */
export function feeAndNet(gross: bigint): { fee: bigint; net: bigint } {
  const fee = tipFee(gross)
  return { fee, net: gross - fee }
}

/** Number of recipients Core pays for an article: its splits, or the author. */
export function recipientCount(splits: ReadonlyArray<unknown>): number {
  return splits.length === 0 ? 1 : splits.length
}

/** Transfers Core counts against `MAX_BATCH_TRANSFERS`: recipients + fee. */
export function transferCount(splits: ReadonlyArray<unknown>): number {
  return recipientCount(splits) + 1
}

/** The v1 highlight string that `highlight_id` hashes (01-architecture.md, 1.4). */
export function highlightSource(
  articleSlug: string,
  startOffset: number,
  endOffset: number,
  text: string
): string {
  return `${articleSlug}:${startOffset}:${endOffset}:${text.slice(0, 50)}`
}

// ---------------------------------------------------------------------------
// Shared checks

export type HighlightInput = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type TipItemInput = {
  articleId: Id<'articles'>
  amountCents: number
  highlight?: HighlightInput | null
  message?: string
}

type PriceQuote = { priceUsd: number; source: string; fetchedAt: number }

/** Values every item of one prepare call shares. */
type TipperContext = {
  chain: ChainEnv & { coreContractId: string; tokenContractId: string }
  userId: Id<'users'>
  user: Doc<'users'>
  tipperAddress: string
  minTip: bigint
  price: PriceQuote
}

/** The v2 gate and the configured contract IDs. */
export function requireTipChain(): TipperContext['chain'] {
  const chain = requireChainV2Enabled()
  if (!chain.coreContractId || !chain.tokenContractId) {
    // The detail stays in the server log; the client sees the code only.
    console.error('tipsV2: CORE_CONTRACT_ID and TOKEN_CONTRACT_ID must be set.')
    tipError(
      'CHAIN_CONFIG_MISSING',
      'Tipping is not configured on this deployment.'
    )
  }
  return chain as TipperContext['chain']
}

/**
 * Counts one record call (07-security-and-recovery.md, section 7.2: the limiter runs on
 * every prepare and submit). A refused call throws, so it writes nothing.
 */
export async function consumeRecordLimit(
  ctx: MutationCtx,
  userId: Id<'users'>,
  now: number
): Promise<void> {
  const limit = await consumeFixedWindow(
    ctx,
    `tipsV2:record:${userId}`,
    RECORD_RATE_LIMIT,
    RECORD_RATE_WINDOW_MS,
    now
  )
  if (!limit.ok) {
    tipError(
      'RATE_LIMITED',
      'Too many requests in a short time. Wait a moment.',
      {
        retryAfterMs: limit.retryAfterMs,
      }
    )
  }
}

/** The cached Core config for the configured contract set, or null. */
export async function cachedCoreConfig(
  ctx: QueryCtx,
  chain: TipperContext['chain']
): Promise<Doc<'chainConfig'> | null> {
  const config = await ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (
    !config ||
    config.chainEpoch !== chain.chainEpoch ||
    config.coreContractId !== chain.coreContractId ||
    config.tokenContractId !== chain.tokenContractId
  ) {
    return null
  }
  return config
}

/** The `min_tip` and pause state from the cached Core config. */
export async function requireCoreOpen(
  ctx: QueryCtx,
  chain: TipperContext['chain']
): Promise<bigint> {
  const config = await cachedCoreConfig(ctx, chain)
  if (!config || !config.minTip || !/^[0-9]{1,39}$/.test(config.minTip)) {
    tipError(
      'CHAIN_CONFIG_MISSING',
      'The Core configuration is not loaded yet. Try again shortly.'
    )
  }
  if (config.paused.core === true) {
    tipError('PAUSED', 'Tipping is paused. Try again later.')
  }
  return BigInt(config.minTip)
}

/** The cached XLM price when it is fresh, otherwise null. */
export async function freshPrice(
  ctx: QueryCtx,
  now: number
): Promise<PriceQuote | null> {
  const row = await ctx.db.query('xlmPriceCache').first()
  if (!row || now - row.fetchedAt > PRICE_MAX_AGE_MS) return null
  if (!(row.priceUsd > 0) || !Number.isFinite(row.priceUsd)) return null
  return {
    priceUsd: row.priceUsd,
    source: row.source,
    fetchedAt: row.fetchedAt,
  }
}

/** The tipper's verified linked address. */
export function requireTipperAddress(
  user: Doc<'users'>,
  chain: TipperContext['chain']
): string {
  const state = walletLinkState(user, chain.passphrase)
  if (state === 'none') {
    tipError('NO_WALLET', 'Connect a Stellar wallet to tip.')
  }
  const address = verifiedStellarAddress(user, chain.passphrase)
  if (state !== 'verified' || !address) {
    tipError('ADDRESS_UNVERIFIED', 'Verify your Stellar wallet to tip.')
  }
  return address
}

/** The article's chain record in the current epoch, if any. */
export async function chainArticleInEpoch(
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

export type TippableArticle = {
  article: Doc<'articles'>
  author: Doc<'users'>
  chainArticle: Doc<'chainArticles'>
}

/**
 * Article-level checks, in order: published, `REGISTERED` in this epoch, and
 * the on-chain author equals the owner's verified linked address.
 */
export async function requireTippableArticle(
  ctx: QueryCtx,
  articleId: Id<'articles'>,
  chain: TipperContext['chain'],
  itemIndex?: number
): Promise<TippableArticle> {
  const at = itemIndex === undefined ? {} : { itemIndex }
  const article = await ctx.db.get(articleId)
  if (!article || !article.published) {
    tipError('ARTICLE_NOT_FOUND', 'Article not found.', at)
  }
  const chainArticle = await chainArticleInEpoch(
    ctx,
    articleId,
    chain.chainEpoch
  )
  if (!chainArticle || chainArticle.status !== 'REGISTERED') {
    tipError(
      'ARTICLE_NOT_REGISTERED',
      'Tips are not enabled for this article yet.',
      at
    )
  }
  const author = await ctx.db.get(article.authorId)
  if (
    !author ||
    verifiedStellarAddress(author, chain.passphrase) !==
      chainArticle.authorAddress
  ) {
    tipError(
      'PAYOUT_ADDRESS_CHANGED',
      "The writer needs to update the article's payout address before it can receive tips.",
      at
    )
  }
  return { article, author, chainArticle }
}

/** The tipper is neither the owner, the on-chain author nor a recipient. */
export function assertNotSelfTip(
  target: TippableArticle,
  userId: Id<'users'>,
  tipperAddress: string,
  itemIndex?: number
): void {
  const { article, chainArticle } = target
  if (
    article.authorId === userId ||
    chainArticle.authorAddress === tipperAddress ||
    chainArticle.splits.some((s) => s.recipient === tipperAddress)
  ) {
    tipError(
      'SELF_TIP',
      'You cannot tip an article you receive tips for.',
      itemIndex === undefined ? {} : { itemIndex }
    )
  }
}

// ---------------------------------------------------------------------------
// Prepare

/** One prepared item, in the shape of Core's `TipInput` plus app fields. */
export type PreparedTipItem = {
  table: 'tips' | 'highlightTips'
  tipId: Id<'tips'> | Id<'highlightTips'>
  articleId: Id<'articles'>
  /** Core `TipInput`, values as strings: hex bytes and a decimal i128. */
  tipInput: {
    /** 32 bytes, lower-case hex. */
    article_id: string
    /** Base units (stroops), decimal string. */
    amount: string
    /** 32 bytes, lower-case hex, or null for an article tip. */
    highlight_id: string | null
    /** 16 bytes, lower-case hex. */
    client_ref: string
  }
  /** v1 28-hex highlight ID for display joins, or null. */
  legacyHighlightId: string | null
  /** The on-chain author the verifier expects. */
  authorAddress: string
  quote: TipQuote
}

/** Display values. Verification never uses them (section 6.4). */
export type TipQuote = {
  amountCents: number
  /** USD per XLM used for the conversion. */
  priceUsd: number
  priceSource: string
  priceFetchedAt: number
  grossBaseUnits: string
  /** Decimal XLM, e.g. "4.4843049". */
  grossXlm: string
  /** `floor(gross × 250 / 10,000)`. */
  feeBaseUnits: string
  netBaseUnits: string
  feeBps: number
}

export type PreparedTip = {
  submissionId: Id<'chainSubmissions'>
  /** `tip` for one item (call `Core.tip`), `tip_batch` for several. */
  method: 'tip' | 'tip_batch'
  status: Doc<'chainSubmissions'>['status']
  /** True when an earlier call with the same `requestId` created it. */
  existing: boolean
  network: 'TESTNET'
  networkPassphrase: string
  chainEpoch: string
  /** Core contract ID. */
  contractId: string
  tokenContractId: string
  /** The tipper's verified address: transaction source and `tipper`. */
  tipperAddress: string
  /** Unix seconds; build with time bounds `[0, maxTime]`. */
  maxTime: number
  items: PreparedTipItem[]
  totals: {
    amountCents: number
    grossBaseUnits: string
    grossXlm: string
    feeBaseUnits: string
    netBaseUnits: string
  }
}

function quoteFor(
  amountCents: number,
  gross: bigint,
  price: PriceQuote
): TipQuote {
  const { fee, net } = feeAndNet(gross)
  return {
    amountCents,
    priceUsd: price.priceUsd,
    priceSource: price.source,
    priceFetchedAt: price.fetchedAt,
    grossBaseUnits: gross.toString(),
    grossXlm: baseUnitsToXlm(gross),
    feeBaseUnits: fee.toString(),
    netBaseUnits: net.toString(),
    feeBps: FEE_BPS,
  }
}

type TipRow = Doc<'tips'> | Doc<'highlightTips'>

function rowItem(
  table: 'tips' | 'highlightTips',
  row: TipRow
): PreparedTipItem {
  const gross = BigInt(row.grossBaseUnits ?? '0')
  return {
    table,
    tipId: row._id,
    articleId: row.articleId,
    tipInput: {
      article_id: row.chainArticleKey ?? '',
      amount: gross.toString(),
      highlight_id: row.chainHighlightKey ?? null,
      client_ref: row.clientRef ?? '',
    },
    legacyHighlightId:
      table === 'highlightTips'
        ? (row as Doc<'highlightTips'>).highlightId
        : null,
    authorAddress: row.expectedAuthorAddress ?? '',
    quote: quoteFor(row.amountCents, gross, {
      priceUsd: row.quotePriceUsd ?? 0,
      source: row.quoteSource ?? '',
      fetchedAt: row.quoteFetchedAt ?? 0,
    }),
  }
}

/** Builds the prepare response from the stored rows (fresh or replayed). */
export async function preparedResponse(
  ctx: QueryCtx,
  submission: Doc<'chainSubmissions'>,
  chain: Pick<ChainEnv, 'network' | 'passphrase'>,
  existing: boolean
): Promise<PreparedTip> {
  const rows = await loadTipRows(ctx, submission)
  const items = rows.map(({ table, row }) => rowItem(table, row))
  const first = rows[0]?.row
  // Fees are per item (Core rounds each tip), so the totals are sums.
  let gross = BigInt(0)
  let feeSum = BigInt(0)
  let netSum = BigInt(0)
  let cents = 0
  for (const item of items) {
    gross += BigInt(item.tipInput.amount)
    feeSum += BigInt(item.quote.feeBaseUnits)
    netSum += BigInt(item.quote.netBaseUnits)
    cents += item.quote.amountCents
  }
  return {
    submissionId: submission._id,
    method: submission.kind === 'tip_batch' ? 'tip_batch' : 'tip',
    status: submission.status,
    existing,
    network: chain.network as 'TESTNET',
    networkPassphrase: chain.passphrase,
    chainEpoch: submission.chainEpoch,
    contractId: submission.contractId,
    tokenContractId: first?.tokenContractId ?? '',
    tipperAddress: first?.expectedTipperAddress ?? '',
    maxTime: submission.maxTime,
    items,
    totals: {
      amountCents: cents,
      grossBaseUnits: gross.toString(),
      grossXlm: baseUnitsToXlm(gross),
      feeBaseUnits: feeSum.toString(),
      netBaseUnits: netSum.toString(),
    },
  }
}

/**
 * Whether a replayed `requestId` asks for exactly what the stored rows hold:
 * the same items in the same order, with the same article, amount, message
 * and highlight passage. The stored passage is the canonical one, whose text
 * and offsets equal the original input; container paths are hints derived
 * from the offsets, so an omitted path matches and a supplied one must equal
 * the stored path.
 */
function sameRequest(
  loaded: Array<{ table: string; row: TipRow }>,
  items: TipItemInput[]
): boolean {
  return (
    loaded.length === items.length &&
    items.every((item, i) => {
      const { table, row } = loaded[i]!
      if (
        row.articleId !== item.articleId ||
        row.amountCents !== item.amountCents ||
        (row.message || '') !== (item.message || '')
      ) {
        return false
      }
      const highlight = item.highlight ?? null
      if (table !== 'highlightTips') return highlight === null
      if (highlight === null) return false
      const stored = row as Doc<'highlightTips'>
      return (
        stored.highlightText === highlight.text &&
        stored.startOffset === highlight.startOffset &&
        stored.endOffset === highlight.endOffset &&
        (highlight.startContainerPath === undefined ||
          highlight.startContainerPath === stored.startContainerPath) &&
        (highlight.endContainerPath === undefined ||
          highlight.endContainerPath === stored.endContainerPath)
      )
    })
  )
}

export type PrepareTipsArgs = {
  userId: Id<'users'>
  requestId: string
  items: TipItemInput[]
  /** `direct` and `highlight` take one item; `batch` takes 1 to 10. */
  mode: 'direct' | 'highlight' | 'batch'
  now: number
}

/**
 * Runs every prepare check, then creates the rows through
 * `prepareTipSubmission`. A repeated `requestId` returns the stored record
 * before any other check, so a retry after a dropped response is free.
 */
export async function prepareTips(
  ctx: MutationCtx,
  args: PrepareTipsArgs
): Promise<PreparedTip> {
  const chain = requireTipChain()
  if (!REQUEST_ID.test(args.requestId)) {
    tipError(
      'INVALID_PREPARE',
      'requestId must be 1 to 100 letters, digits, "-" or "_".'
    )
  }

  const prior = await ctx.db
    .query('chainSubmissions')
    .withIndex('by_request', (q) => q.eq('requestId', args.requestId))
    .first()
  if (prior) {
    const loaded = await loadTipRows(ctx, prior)
    if (
      prior.userId !== args.userId ||
      (prior.kind !== 'tip' && prior.kind !== 'tip_batch') ||
      !sameRequest(loaded, args.items)
    ) {
      tipError(
        'REQUEST_CONFLICT',
        'requestId was already used for a different request.'
      )
    }
    return preparedResponse(ctx, prior, chain, true)
  }

  if (args.items.length === 0) {
    tipError('BATCH_EMPTY', 'Add at least one tip.')
  }
  if (args.items.length > MAX_BATCH_ITEMS) {
    tipError(
      'BATCH_TOO_LARGE',
      `A batch holds at most ${MAX_BATCH_ITEMS} tips.`,
      { maxItems: MAX_BATCH_ITEMS, maxTransfers: MAX_BATCH_TRANSFERS }
    )
  }
  if (args.mode !== 'batch' && args.items.length !== 1) {
    tipError('INVALID_PREPARE', 'A direct tip has exactly one item.')
  }

  const limit = await consumeFixedWindow(
    ctx,
    `tipsV2:prepare:${args.userId}`,
    PREPARE_RATE_LIMIT,
    PREPARE_RATE_WINDOW_MS,
    args.now
  )
  if (!limit.ok) {
    tipError('RATE_LIMITED', 'Too many tips in a short time. Wait a moment.', {
      retryAfterMs: limit.retryAfterMs,
    })
  }

  const user = await ctx.db.get(args.userId)
  if (!user) tipError('UNAUTHENTICATED', 'Sign in first.')
  const tipperAddress = requireTipperAddress(user, chain)
  const minTip = await requireCoreOpen(ctx, chain)
  const price = await freshPrice(ctx, args.now)
  if (!price) {
    tipError(
      'PRICE_UNAVAILABLE',
      'The XLM price is not available right now. Try again shortly.'
    )
  }

  const items: PrepareTipItem[] = []
  let transfers = 0
  for (const [index, input] of args.items.entries()) {
    const itemIndex = args.mode === 'batch' ? index : undefined
    const at = itemIndex === undefined ? {} : { itemIndex }
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents < TIP_MIN_CENTS ||
      input.amountCents > TIP_MAX_CENTS
    ) {
      tipError(
        'INVALID_AMOUNT',
        `A tip is ${TIP_MIN_CENTS} to ${TIP_MAX_CENTS} cents.`,
        at
      )
    }
    if (input.message && input.message.length > MAX_MESSAGE_LENGTH) {
      tipError(
        'INVALID_PREPARE',
        `A message is at most ${MAX_MESSAGE_LENGTH} characters.`,
        at
      )
    }
    const target = await requireTippableArticle(
      ctx,
      input.articleId,
      chain,
      itemIndex
    )
    assertNotSelfTip(target, args.userId, tipperAddress, itemIndex)

    const gross = centsToBaseUnits(input.amountCents, price.priceUsd)
    if (gross < minTip) {
      tipError(
        'BELOW_MINIMUM',
        `The smallest tip is ${minimumCents(minTip, price.priceUsd)} cents.`,
        { ...at, minTipBaseUnits: minTip.toString() }
      )
    }
    transfers += transferCount(target.chainArticle.splits)

    const { article, author, chainArticle } = target
    const fields = {
      articleId: article._id,
      tipperId: args.userId,
      authorId: article.authorId,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: user.name || user.username,
      tipperAvatar: user.avatar,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      amountUsd: input.amountCents / 100,
      amountCents: input.amountCents,
      ...(input.message ? { message: input.message } : {}),
      quotePriceUsd: price.priceUsd,
      quoteSource: price.source,
      quoteFetchedAt: price.fetchedAt,
    }
    const common = {
      articleKey: chainArticle.articleKey,
      authorAddress: chainArticle.authorAddress,
      grossBaseUnits: gross.toString(),
    }

    if (input.highlight) {
      const passage = canonicalPassage(article, input.highlight, itemIndex)
      const highlightKey = await highlightIdHex(
        highlightSource(
          article.slug,
          passage.startOffset,
          passage.endOffset,
          passage.highlightText
        )
      )
      items.push({
        table: 'highlightTips',
        fields: {
          ...fields,
          highlightId: highlightKey.slice(0, 28),
          highlightText: passage.highlightText,
          startOffset: passage.startOffset,
          endOffset: passage.endOffset,
          startContainerPath: passage.startContainerPath,
          endContainerPath: passage.endContainerPath,
        },
        highlightKey,
        ...common,
      })
    } else {
      items.push({ table: 'tips', fields, ...common })
    }
  }

  if (transfers > MAX_BATCH_TRANSFERS) {
    tipError(
      'BATCH_TOO_LARGE',
      `These tips need ${transfers} transfers; one transaction allows ${MAX_BATCH_TRANSFERS}.`,
      {
        maxItems: MAX_BATCH_ITEMS,
        maxTransfers: MAX_BATCH_TRANSFERS,
        transferCount: transfers,
      }
    )
  }

  const prepared = await prepareTipSubmission(ctx, {
    userId: args.userId,
    requestId: args.requestId,
    tipperAddress,
    items,
    now: args.now,
  })
  const submission = (await ctx.db.get(prepared.submissionId))!
  return preparedResponse(ctx, submission, chain, false)
}

function canonicalPassage(
  article: Doc<'articles'>,
  highlight: HighlightInput,
  itemIndex?: number
) {
  const at = itemIndex === undefined ? {} : { itemIndex }
  if (
    !highlight.text.trim() ||
    highlight.text.length > MAX_HIGHLIGHT_TEXT ||
    !validContainerPath(highlight.startContainerPath) ||
    !validContainerPath(highlight.endContainerPath)
  ) {
    tipError('HIGHLIGHT_INVALID', 'The highlighted passage is not valid.', at)
  }
  try {
    return resolveCanonicalHighlightPassage(article.content, {
      highlightText: highlight.text,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      startContainerPath: highlight.startContainerPath,
      endContainerPath: highlight.endContainerPath,
    })
  } catch {
    tipError(
      'HIGHLIGHT_INVALID',
      'The highlighted passage does not match the article.',
      at
    )
  }
}

function validContainerPath(path: string | undefined): boolean {
  return path === undefined || (path.length <= 256 && /^text\.\d+$/.test(path))
}

// ---------------------------------------------------------------------------
// Status

/** What the UI shows for a record (06-app-integration.md, section 6.1). */
export type TipUiState =
  | 'checking'
  | 'confirmed'
  | 'mismatch_author'
  | 'mismatch_review'
  | 'failed'
  | 'expired'

/**
 * Maps a stored status to the UI state. A `FAILED` or `EXPIRED` record that
 * is flagged for review (an event arrived after all) is `mismatch_review`:
 * money may have moved, so no retry is offered (I-24).
 */
export function tipUiState(record: {
  status: string
  mismatchReason?: string | null
  needsReview?: boolean | null
}): TipUiState {
  switch (record.status) {
    case 'CONFIRMED':
      return 'confirmed'
    case 'MISMATCH':
      return record.mismatchReason === 'author'
        ? 'mismatch_author'
        : 'mismatch_review'
    case 'FAILED':
      return record.needsReview === true ? 'mismatch_review' : 'failed'
    case 'EXPIRED':
      return record.needsReview === true ? 'mismatch_review' : 'expired'
    default:
      return 'checking'
  }
}

/** Retry (a new prepare with a new `requestId`) only after FAILED or EXPIRED. */
export function tipCanRetry(record: {
  status: string
  needsReview?: boolean | null
}): boolean {
  return (
    (record.status === 'FAILED' || record.status === 'EXPIRED') &&
    record.needsReview !== true
  )
}

/** Values decoded from the on-chain `Tipped` event, when verified. */
export type TipChainAmounts = {
  grossBaseUnits: string
  feeBaseUnits: string | null
  netBaseUnits: string | null
  tokenContractId: string | null
  authorAddress: string | null
  tipperAddress: string | null
  contentHash: string | null
  contentVersion: number | null
}

export type TipItemStatus = {
  table: 'tips' | 'highlightTips'
  tipId: Id<'tips'> | Id<'highlightTips'>
  articleId: Id<'articles'>
  clientRef: string | null
  status: string
  uiState: TipUiState
  mismatchReason: string | null
  needsReview: boolean
  failureReason: string | null
  amountCents: number
  /** The amount prepared, in base units. */
  preparedBaseUnits: string | null
  /** The author the record expected; the payment may have gone elsewhere. */
  expectedAuthorAddress: string | null
  chain: TipChainAmounts | null
}

export type TipStatus = {
  submissionId: Id<'chainSubmissions'>
  method: 'tip' | 'tip_batch'
  status: Doc<'chainSubmissions'>['status']
  uiState: TipUiState
  canRetry: boolean
  needsReview: boolean
  mismatchReason: string | null
  txHash: string | null
  ledger: number | null
  maxTime: number
  contractId: string
  items: TipItemStatus[]
  /** Sums of the decoded amounts; null until every item has them. */
  chainTotals: {
    grossBaseUnits: string
    feeBaseUnits: string
    netBaseUnits: string
  } | null
}

function chainAmounts(row: TipRow): TipChainAmounts | null {
  if (!row.onChainGrossBaseUnits) return null
  return {
    grossBaseUnits: row.onChainGrossBaseUnits,
    feeBaseUnits: row.feeBaseUnits ?? null,
    netBaseUnits: row.netBaseUnits ?? null,
    tokenContractId: row.onChainTokenContractId ?? null,
    authorAddress: row.onChainAuthorAddress ?? null,
    tipperAddress: row.onChainTipperAddress ?? null,
    contentHash: row.chainContentHash ?? null,
    contentVersion: row.chainContentVersion ?? null,
  }
}

export async function tipStatusFor(
  ctx: QueryCtx,
  submission: Doc<'chainSubmissions'>
): Promise<TipStatus> {
  const rows = await loadTipRows(ctx, submission)
  const items: TipItemStatus[] = rows.map(({ table, row }) => ({
    table,
    tipId: row._id,
    articleId: row.articleId,
    clientRef: row.clientRef ?? null,
    status: row.status,
    uiState: tipUiState(row),
    mismatchReason: row.mismatchReason ?? null,
    needsReview: row.needsReview === true,
    failureReason: row.failureReason ?? null,
    amountCents: row.amountCents,
    preparedBaseUnits: row.grossBaseUnits ?? null,
    expectedAuthorAddress: row.expectedAuthorAddress ?? null,
    chain: chainAmounts(row),
  }))
  let chainTotals: TipStatus['chainTotals'] = null
  if (
    items.length > 0 &&
    items.every((i) => i.chain && i.chain.feeBaseUnits && i.chain.netBaseUnits)
  ) {
    let gross = BigInt(0)
    let fee = BigInt(0)
    let net = BigInt(0)
    for (const item of items) {
      gross += BigInt(item.chain!.grossBaseUnits)
      fee += BigInt(item.chain!.feeBaseUnits!)
      net += BigInt(item.chain!.netBaseUnits!)
    }
    chainTotals = {
      grossBaseUnits: gross.toString(),
      feeBaseUnits: fee.toString(),
      netBaseUnits: net.toString(),
    }
  }
  return {
    submissionId: submission._id,
    method: submission.kind === 'tip_batch' ? 'tip_batch' : 'tip',
    status: submission.status,
    uiState: tipUiState(submission),
    canRetry: tipCanRetry(submission),
    needsReview: submission.needsReview === true,
    mismatchReason: submission.mismatchReason ?? null,
    txHash: submission.txHash ?? null,
    ledger: submission.ledger ?? null,
    maxTime: submission.maxTime,
    contractId: submission.contractId,
    items,
    chainTotals,
  }
}

/** True for the submission kinds this module owns. */
export function isTipSubmission(submission: Doc<'chainSubmissions'>): boolean {
  return submission.kind === 'tip' || submission.kind === 'tip_batch'
}
