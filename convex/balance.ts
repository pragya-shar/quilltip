/**
 * The reader's balance. One reactive query keyed by
 * the signed-in user, not by a connected wallet: the screens and the tip
 * control read the balance, its limits, this reader's registered devices and
 * the ledger clock from here, so nothing waits for a wallet to load.
 *
 * Figures come from the tab ledger (`convex/lib/chain/tabLedger.ts`) and are
 * explained in `convex/lib/moneyViews.ts` (invariants M1 to M4). Tips are
 * still accepted by `tabs.prepareTip` and `tabs.submitTip`.
 */
import { getAuthSessionId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { readChainEnv } from './lib/chain/env'
import {
  maxCentsWithin,
  readerSpendable,
  reservedOf,
  tabAccountForReader,
  tabLimits,
} from './lib/chain/tabLedger'
import {
  cachedPrice,
  caller,
  centsFromBaseUnits,
  minimumTipCents,
  settlementExpectation,
} from './lib/moneyViews'
import { verifiedStellarAddress } from './lib/walletVerification'

/** The tip a single tap sends, in US cents. */
export const DEFAULT_TIP_CENTS = 100
/** The largest amount the quick choices beside the tip button offer. */
export const QUICK_TIP_MAX_CENTS = 500
/** Accepted tips whose `requestId` the session lists, newest first. */
export const RECENT_REQUESTS = 20

async function cursorClock(
  ctx: QueryCtx,
  chain: { network: 'TESTNET' | 'MAINNET'; chainEpoch: string }
): Promise<{ sequence: number; closedAt: number } | null> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (!cursor || cursor.chainEpoch !== chain.chainEpoch) return null
  if (cursor.latestLedger <= 0) return null
  return { sequence: cursor.latestLedger, closedAt: cursor.updatedAt }
}

/**
 * The signed-in reader's balance, or null when signed out.
 *
 * - `status`: `none` (no verified address or no balance yet), `open`, or
 *   `closing` (a withdrawal is pending; no new tips).
 * - `availableCents`: what a tip can use now (M2), at the cached price.
 *   `pendingCents`: accepted tips not yet paid on chain, at their own cents.
 * - `recentRequestIds`: the newest accepted tips' request ids, so the client
 *   drops an optimistic tip from this same snapshot, never counting it twice.
 * - `ledger`: the indexer's latest ledger, for device-key expiry without a
 *   Stellar RPC read.
 * - `sessionId`: the auth session this answer is for. With `userId` it is
 *   the pair the client binds these figures to, and shows them only while
 *   the browser's session token names the same pair.
 */
export const session = query({
  args: {},
  handler: async (ctx) => {
    const me = await caller(ctx)
    if (!me) return null
    const { chain } = me
    const price = await cachedPrice(ctx)
    const settlement = settlementExpectation()
    const ledger = await cursorClock(ctx, chain)
    const sessionId = await getAuthSessionId(ctx)
    const base = {
      userId: me.userId,
      sessionId,
      accountAddress: me.address,
      network: 'testnet' as const,
      wallet: me.address
        ? {
            address: me.address,
            verifiedAt: me.user.stellarAddressVerifiedAt ?? 0,
          }
        : null,
      prices: price ? [{ token: 'xlm', usd: price.usd, at: price.at }] : [],
      ledger,
      settlement,
    }
    const account =
      me.address && chain.tabContractId
        ? await tabAccountForReader(ctx, me.address, chain.chainEpoch)
        : null
    if (!account || account.userId !== me.userId || account.status === 'CLOSED')
      return {
        ...base,
        status: 'none' as const,
        tokens: [],
        availableCents: 0,
        pendingCents: 0,
        limits: null,
        devices: [],
        recentRequestIds: [] as string[],
        onChain: false,
      }

    // The one definition of spendable (it can be negative: shown as 0).
    const spendable = readerSpendable(account)
    const available = spendable > BigInt(0) ? spendable : BigInt(0)
    const availableCents = price ? centsFromBaseUnits(available, price.usd) : 0
    // A running figure kept with each receipt's state, never a scan.
    const pendingCents = account.reservedCents ?? 0

    // The newest accepted tips' request ids: one page, not a total.
    const newest = await ctx.db
      .query('tabReceipts')
      .withIndex('by_account_accepted', (q) =>
        q.eq('tabAccountId', account._id)
      )
      .order('desc')
      .take(RECENT_REQUESTS)
    const recentRequestIds: string[] = []
    for (const receipt of newest) {
      const requestId =
        receipt.requestId ??
        ((await ctx.db.get(receipt.tipRowId)) as { requestId?: string } | null)
          ?.requestId
      if (requestId) recentRequestIds.push(requestId)
    }

    const config = await ctx.db
      .query('chainConfig')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    const minTip =
      config && config.chainEpoch === chain.chainEpoch && config.minTip
        ? BigInt(config.minTip)
        : null
    let limits = null
    try {
      const l = tabLimits()
      limits = price
        ? {
            perTipCents: maxCentsWithin(l.tipMax, price.usd),
            dailyCents: maxCentsWithin(l.dailyLimit, price.usd),
            acceptedDay: account.acceptedDay,
            acceptedTodayCents: centsFromBaseUnits(
              BigInt(account.acceptedToday),
              price.usd
            ),
            minTipCents: minTip ? minimumTipCents(minTip, price.usd) : null,
            quickTipMaxCents: QUICK_TIP_MAX_CENTS,
            defaultTipCents: DEFAULT_TIP_CENTS,
          }
        : null
    } catch {
      limits = null
    }

    const keys = await ctx.db
      .query('tabSessionKeys')
      .withIndex('by_account_key', (q) => q.eq('tabAccountId', account._id))
      .take(200)

    return {
      ...base,
      status:
        account.status === 'CLOSING' ? ('closing' as const) : ('open' as const),
      tokens: [
        {
          token: 'xlm',
          contractId: chain.tokenContractId ?? '',
          confirmed: account.confirmedBalance,
          // Accepted and unsettled, plus settled but not yet debited.
          outstanding: reservedOf(account).toString(),
          available: available.toString(),
          availableCents,
        },
      ],
      availableCents,
      pendingCents,
      limits,
      devices: keys.map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey ?? null,
        validUntilLedger: k.validUntilLedger,
        revoked: k.revoked,
      })),
      recentRequestIds,
      // False while the account exists only because an open was prepared.
      onChain:
        account.balanceEventId !== undefined ||
        account.statusEventId !== undefined,
    }
  },
})

/**
 * Whether the signed-in reader can tip this article from the balance, and
 * if not, why: the checks of acceptance that depend on the article only
 * (`tabLedger.checkTabTip`). Prepare still decides.
 */
export const tipContext = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    const me = await caller(ctx)
    const article = await ctx.db.get(args.articleId)
    const no = (reason: string, ownArticle = false) => ({
      tippable: false,
      reason,
      ownArticle,
    })
    if (!article) return no('not-tippable')
    if (me && article.authorId === me.userId) return no('own-article', true)
    const chain = me?.chain ?? readChainEnv()
    if (!chain.tabContractId) return no('not-tippable')
    const chainArticle = (
      await ctx.db
        .query('chainArticles')
        .withIndex('by_article', (q) =>
          q.eq('articleId', args.articleId as Id<'articles'>)
        )
        .take(20)
    ).find((row) => row.chainEpoch === chain.chainEpoch)
    if (!chainArticle || chainArticle.status !== 'REGISTERED')
      return no('not-tippable')
    if (
      chainArticle.splits.length > 1 ||
      chainArticle.splits.some(
        (s) => s.recipient !== chainArticle.authorAddress
      )
    )
      return no('splits')
    const author = await ctx.db.get(article.authorId)
    if (
      !author ||
      verifiedStellarAddress(author, chain.passphrase) !==
        chainArticle.authorAddress
    )
      return no('not-tippable')
    if (me?.address && me.address === chainArticle.authorAddress)
      return no('own-article', true)
    return { tippable: true, reason: null, ownArticle: false }
  },
})

/** How many request ids `acceptedRequests` looks up in one call. */
export const ACCEPTED_LOOKUP_MAX = 50

/**
 * Which of these request ids (a device's unanswered tips, at most
 * `ACCEPTED_LOOKUP_MAX`) the server accepted for this reader. The session
 * lists only the newest accepted ids; this answers for the device's own
 * tips at any position, so an accepted tip never stays "Sending" or
 * reserved twice because other tips were accepted after it.
 */
export const acceptedRequests = query({
  args: { requestIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const me = await caller(ctx)
    if (!me?.address || !me.chain.tabContractId) return []
    const account = await tabAccountForReader(
      ctx,
      me.address,
      me.chain.chainEpoch
    )
    if (!account || account.userId !== me.userId) return []
    const accepted: string[] = []
    for (const requestId of args.requestIds.slice(0, ACCEPTED_LOOKUP_MAX)) {
      const receipt = await ctx.db
        .query('tabReceipts')
        .withIndex('by_request', (q) => q.eq('requestId', requestId))
        .first()
      if (receipt?.tabAccountId === account._id) accepted.push(requestId)
    }
    return accepted
  },
})

/**
 * The amounts a tip can take, from public data only (the minimum tip, the
 * per-tip cap and the current price): what a signed-out visitor's tip
 * button states. No balance, no daily remainder, no account. Null when
 * tips are not set up or no price is cached.
 */
export const publicTipTerms = query({
  args: {},
  handler: async (ctx) => {
    const chain = readChainEnv()
    if (!chain.tabContractId) return null
    const price = await cachedPrice(ctx)
    if (!price) return null
    const config = await ctx.db
      .query('chainConfig')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    const minTip =
      config && config.chainEpoch === chain.chainEpoch && config.minTip
        ? BigInt(config.minTip)
        : null
    try {
      return {
        perTipCents: maxCentsWithin(tabLimits().tipMax, price.usd),
        minTipCents: minTip ? minimumTipCents(minTip, price.usd) : null,
        quickTipMaxCents: QUICK_TIP_MAX_CENTS,
        defaultTipCents: DEFAULT_TIP_CENTS,
        priceUsd: price.usd,
      }
    } catch {
      return null
    }
  },
})
