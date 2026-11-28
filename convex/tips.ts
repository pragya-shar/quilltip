import { getTipArticleSummary } from './lib/tipArticleSummary'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { paginationOptsValidator } from 'convex/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { enrichWithUser } from './lib/enrich'
import { getStellarNetwork } from './lib/constants'
import { verifiedStellarAddress } from './lib/walletVerification'
import { readChainEnv } from './lib/chain/env'
import { roundCents } from './lib/authorEarnings'
import {
  lifetimeFigures,
  previousFigures,
  readLifetimeTotals,
} from './lib/lifetimeEarnings'
import {
  AGGREGATE_LIMIT,
  LIST_LIMIT,
  chainArticleFor,
  clampPageSize,
  contractVersionOf,
  countsAsPaid,
  ownTipFields,
  paidToExpectedAuthor,
  publicTipFields,
  registeredTotals,
  withTipper,
} from './lib/tipReads'

/**
 * Public list of an article's paid tips, newest first: v1 and v2 rows,
 * labelled by `contractVersion`, with public fields only. Reads at most
 * `LIST_LIMIT` rows; use `listArticleTips` to page.
 */
export const getArticleTips = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .order('desc')
      .take(AGGREGATE_LIMIT)
    const paid = rows.filter(countsAsPaid).slice(0, LIST_LIMIT)
    return await Promise.all(
      paid.map(async (tip) => ({
        ...publicTipFields(tip),
        tipper: await withTipper(ctx.db, tip),
      }))
    )
  },
})

/** Paginated public list of an article's paid tips, newest first. */
export const listArticleTips = query({
  args: {
    articleId: v.id('articles'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .order('desc')
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(args.paginationOpts.numItems),
      })
    const page = await Promise.all(
      result.page.filter(countsAsPaid).map(async (tip) => ({
        ...publicTipFields(tip),
        tipper: await withTipper(ctx.db, tip),
      }))
    )
    return { ...result, page }
  },
})

/**
 * Public tip statistics for an article.
 *
 * - `totalsBaseUnits`: gross per token from `chainArticles.totals`, which
 *   includes v2 tips made outside the app. Empty until the article is
 *   registered.
 * - `totalTips`, `totalAmountUsd`, `uniqueTippers`, `byVersion`: from the
 *   paid tip rows (v1 and v2), at most `AGGREGATE_LIMIT` rows; `complete` is
 *   false when there are more.
 */
export const getArticleTipStats = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const [rows, chainArticle] = await Promise.all([
      ctx.db
        .query('tips')
        .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
        .take(AGGREGATE_LIMIT + 1),
      chainArticleFor(ctx.db, args.articleId),
    ])
    const complete = rows.length <= AGGREGATE_LIMIT
    const tips = rows.slice(0, AGGREGATE_LIMIT).filter(countsAsPaid)

    const byVersion = { v1: 0, v2: 0 }
    let totalAmountCents = 0
    for (const tip of tips) {
      byVersion[contractVersionOf(tip)] += 1
      totalAmountCents += tip.amountCents
    }
    return {
      totalTips: tips.length,
      totalAmountUsd: roundCents(totalAmountCents) / 100,
      uniqueTippers: new Set(tips.map((tip) => tip.tipperId)).size,
      byVersion,
      totalsBaseUnits: registeredTotals(chainArticle),
      registered: chainArticle?.status === 'REGISTERED',
      network: getStellarNetwork(),
      complete,
    }
  },
})

// Get the caller's tip history. Intentionally returns rows in every status
// (PREPARED / SUBMITTED / CONFIRMED / MISMATCH / FAILED / EXPIRED for v2, and
// PENDING / CONFIRMED / FAILED / FRAUDULENT for v1) so the tipper sees
// in-flight and rejected tips in their own history — do NOT add a status
// filter here. Every row is labelled by `contractVersion`. At most
// `LIST_LIMIT` rows; use `listMySentTips` to page.
export const getUserSentTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const tips = await ctx.db
      .query('tips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', userId))
      .order('desc')
      .take(LIST_LIMIT)

    return await Promise.all(
      tips.map(async (tip) => {
        const article = await ctx.db.get(tip.articleId)
        return {
          ...tip,
          contractVersion: contractVersionOf(tip),
          sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
        }
      })
    )
  },
})

/** Paginated tip history of the caller (every status), newest first. */
export const listMySentTips = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return { page: [], isDone: true, continueCursor: '' }
    const result = await ctx.db
      .query('tips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', userId))
      .order('desc')
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(args.paginationOpts.numItems),
      })
    const page = await Promise.all(
      result.page.map(async (tip) => ({
        ...ownTipFields(tip),
        sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
      }))
    )
    return { ...result, page }
  },
})

/**
 * The caller's received tips, newest first: paid v1 and v2 rows whose payment
 * reached the caller. A v2 `MISMATCH` row counts only when the on-chain author
 * address is the caller's linked address. At most `LIST_LIMIT` rows.
 */
export const getUserReceivedTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []
    const user = await ctx.db.get(userId)

    const rows = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .order('desc')
      .take(AGGREGATE_LIMIT)
    const tips = rows
      .filter((tip) => paidToExpectedAuthor(tip, verifiedStellarAddress(user)))
      .slice(0, LIST_LIMIT)

    return await Promise.all(
      tips.map(async (tip) => {
        const [tipper, article] = await Promise.all([
          enrichWithUser(ctx, tip.tipperId),
          ctx.db.get(tip.articleId),
        ])
        return {
          ...tip,
          contractVersion: contractVersionOf(tip),
          sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
          tipper,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
              }
            : null,
        }
      })
    )
  },
})

/** Paginated received tips of the caller, newest first (paid rows only). */
export const listMyReceivedTips = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return { page: [], isDone: true, continueCursor: '' }
    const user = await ctx.db.get(userId)
    const result = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .order('desc')
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(args.paginationOpts.numItems),
      })
    const page = await Promise.all(
      result.page
        .filter((tip) =>
          paidToExpectedAuthor(tip, verifiedStellarAddress(user))
        )
        .map(async (tip) => ({
          ...ownTipFields(tip),
          tipper: await withTipper(ctx.db, tip),
          sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
        }))
    )
    return { ...result, page }
  },
})

// Get author earnings
export const getAuthorEarnings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    return earnings
  },
})

// The caller's earnings as a writer. Owner only.
//
// The fields of `overhaul/v2` keep their meaning for every row, rebuilt or
// not, so a client built before #552 shows the same figures:
// - `tipCount`, `earnedStroops`, `estimatedUsd`, `writerShareStroops`,
//   `complete`: the verified v1 rows read (at most AGGREGATE_LIMIT per table;
//   `complete` is false beyond) plus `v2TipCount`, `v2EarnedCents` and
//   `earnedBaseUnits` in native XLM as stored (`previousFigures`).
// - `earnedBaseUnits`, `v2TipCount`: as stored (section 6.2).
// New fields (#552):
// - `lifetime`: once the row is rebuilt from its history (`lifetimeTotalsAt`)
//   and no rebuild is in progress, the lifetime totals, credited with each tip
//   (convex/lib/lifetimeEarnings.ts). They cover the same tips in all three
//   figures: verified v1 tips, confirmed v2 wallet tips (the caller's share)
//   and the net paid on chain for tab tips. XLM = `v1ShareStroops` +
//   `walletEarnedBaseUnits` + `tabSettledBaseUnits`; USD = `v1EarnedCents` +
//   `v2EarnedCents` + `tabEarnedCents`; count = `v1TipCount` + `v2TipCount` +
//   `tabTipCount`. Null until then.
// - `updating`: the row's rebuild is in progress.
// - `unpricedTipCount`: legacy v1 tips without a trusted USD amount among the
//   previous figures' rows; they are in the XLM and the count, so the USD is a
//   lower bound. `lifetime.unpricedTipCount` is the same for the lifetime
//   totals.
// The network is returned so the UI can label testnet amounts as having no
// real value.
const earningsFiguresValidator = v.object({
  tipCount: v.number(),
  writerShareStroops: v.string(),
  earnedStroops: v.string(),
  estimatedUsd: v.number(),
  unpricedTipCount: v.number(),
})

export const getMyEarningsSummary = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      network: v.union(v.literal('TESTNET'), v.literal('MAINNET')),
      tipCount: v.number(),
      writerShareStroops: v.string(),
      earnedStroops: v.string(),
      estimatedUsd: v.number(),
      earnedBaseUnits: v.record(v.string(), v.string()),
      v2TipCount: v.number(),
      complete: v.boolean(),
      unpricedTipCount: v.number(),
      lifetime: v.union(v.null(), earningsFiguresValidator),
      updating: v.boolean(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    let xlmToken: string | null = null
    try {
      xlmToken = readChainEnv().tokenContractId
    } catch {
      // Not a v2 deployment: v1 rows only.
    }
    const previous = await previousFigures(ctx.db, userId, earnings, xlmToken)
    const rebuilt =
      earnings?.lifetimeTotalsAt !== undefined && !earnings.lifetimeRebuild
    let lifetime = null
    if (rebuilt) {
      const totals = lifetimeFigures(
        readLifetimeTotals(earnings),
        earnings,
        xlmToken
      )
      lifetime = {
        tipCount: totals.tipCount,
        writerShareStroops: totals.v1Stroops,
        earnedStroops: totals.stroops.toString(),
        // Cents carry four decimals; dollars six, without float noise.
        estimatedUsd: Math.round(totals.cents * 10_000) / 1_000_000,
        unpricedTipCount: totals.unpriced,
      }
    }
    return {
      network: getStellarNetwork(),
      tipCount: previous.tipCount,
      writerShareStroops: previous.v1Stroops,
      earnedStroops: previous.stroops.toString(),
      // As `overhaul/v2` computes it.
      estimatedUsd: previous.cents / 100,
      earnedBaseUnits: earnings?.earnedBaseUnits ?? {},
      v2TipCount: earnings?.v2TipCount ?? 0,
      complete: previous.complete,
      unpricedTipCount: previous.unpriced,
      lifetime,
      updating: !!earnings?.lifetimeRebuild,
    }
  },
})
