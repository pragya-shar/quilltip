import { getTipArticleSummary } from './lib/tipArticleSummary'
import { query } from './_generated/server'
import { paginationOptsValidator } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import { enrichWithUser } from './lib/enrich'
import { roundCents } from './lib/authorEarnings'
import {
  AGGREGATE_LIMIT,
  LIST_LIMIT,
  clampPageSize,
  contractVersionOf,
  countByVersion,
  countsAsPaid,
  ownTipFields,
  paidToExpectedAuthor,
  sumBaseUnitsByToken,
} from './lib/tipReads'
import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { verifiedStellarAddress } from './lib/walletVerification'

/**
 * Public aggregate stats for one highlight: paid v1 and v2 tips. Raw tipper
 * and Stellar data stays in the authenticated history queries below. Reads at
 * most `AGGREGATE_LIMIT` rows; `complete` is false beyond that.
 */
export const getByHighlight = query({
  args: {
    highlightId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('highlightTips')
      .withIndex('by_highlight', (q) => q.eq('highlightId', args.highlightId))
      .take(AGGREGATE_LIMIT + 1)
    const tips = rows.slice(0, AGGREGATE_LIMIT).filter(countsAsPaid)
    const totalAmountCents = roundCents(
      tips.reduce((sum, tip) => sum + tip.amountCents, 0)
    )
    return {
      tipCount: tips.length,
      totalAmountCents,
      totalAmountUsd: totalAmountCents / 100,
      byVersion: countByVersion(tips),
      grossBaseUnits: sumBaseUnitsByToken(tips),
      complete: rows.length <= AGGREGATE_LIMIT,
    }
  },
})

/**
 * Aggregate highlight groups for an article heatmap: paid v1 and v2 tips,
 * grouped by highlight. Raw tipper or Stellar data is never returned. Reads at
 * most `AGGREGATE_LIMIT` rows (newest first).
 */
export const getByArticle = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .order('desc')
      .take(AGGREGATE_LIMIT)
    return groupByHighlight(rows.filter(countsAsPaid)).map((group) => ({
      highlightId: group.highlightId,
      highlightText: group.text,
      startOffset: group.startOffset,
      endOffset: group.endOffset,
      totalAmountCents: group.totalAmountCents,
      tipCount: group.tipCount,
      grossBaseUnits: group.grossBaseUnits,
    }))
  },
})

/**
 * The caller's highlight tipping history. Intentionally returns rows in every
 * status (v1 PENDING / CONFIRMED / FAILED, v2 PREPARED to EXPIRED) so the
 * tipper sees in-flight and rejected tips — do NOT add a status filter here.
 * Rows are labelled by `contractVersion`. At most `LIST_LIMIT` rows; use
 * `listMySent` to page.
 */
export const getByTipper = query({
  args: {},
  handler: async (ctx) => {
    const tipperId = await getAuthUserId(ctx)
    if (!tipperId) return []

    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', tipperId))
      .order('desc')
      .take(LIST_LIMIT)
    return await Promise.all(
      tips.map(async (tip) => ({
        ...tip,
        contractVersion: contractVersionOf(tip),
        sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
      }))
    )
  },
})

/** Paginated highlight tipping history of the caller (every status). */
export const listMySent = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const tipperId = await getAuthUserId(ctx)
    if (!tipperId) return { page: [], isDone: true, continueCursor: '' }
    const result = await ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', tipperId))
      .order('desc')
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(args.paginationOpts.numItems),
      })
    const page = await Promise.all(
      result.page.map(async (tip) => ({
        ...ownTipFields(tip),
        highlightId: tip.highlightId,
        highlightText: tip.highlightText,
        sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
      }))
    )
    return { ...result, page }
  },
})

/**
 * Highlight tips received by the caller: paid v1 and v2 rows whose payment
 * reached the caller (a v2 `MISMATCH` only when the on-chain author address is
 * the caller's linked address). Mirrors tips.getUserReceivedTips. At most
 * `LIST_LIMIT` rows; use `listMyReceived` to page.
 */
export const getByAuthor = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await getAuthUserId(ctx)
    if (!authorId) return []
    const user = await ctx.db.get(authorId)

    const rows = await ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', authorId))
      .order('desc')
      .take(AGGREGATE_LIMIT)
    const tips = rows
      .filter((tip) => paidToExpectedAuthor(tip, verifiedStellarAddress(user)))
      .slice(0, LIST_LIMIT)
    return await Promise.all(
      tips.map(async (tip) => ({
        ...tip,
        contractVersion: contractVersionOf(tip),
        sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
      }))
    )
  },
})

/** Paginated highlight tips received by the caller (paid rows only). */
export const listMyReceived = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const authorId = await getAuthUserId(ctx)
    if (!authorId) return { page: [], isDone: true, continueCursor: '' }
    const user = await ctx.db.get(authorId)
    const result = await ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', authorId))
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
          highlightId: tip.highlightId,
          highlightText: tip.highlightText,
          tipper: await enrichWithUser(ctx, tip.tipperId),
          sourceArticle: await getTipArticleSummary(ctx, tip.articleId),
        }))
    )
    return { ...result, page }
  },
})

/**
 * Aggregate stats for an article's highlight tips: paid v1 and v2 rows, so the
 * numbers match what the heatmap displays. Reads at most `AGGREGATE_LIMIT`
 * rows; `complete` is false beyond that.
 */
export const getArticleStats = query({
  args: {
    articleId: v.id('articles'),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .order('desc')
      .take(AGGREGATE_LIMIT + 1)
    const complete = rows.length <= AGGREGATE_LIMIT
    const tips = rows
      .slice(0, AGGREGATE_LIMIT)
      .filter(countsAsPaid)
      .filter(
        (tip) => args.sinceMs === undefined || tip.createdAt >= args.sinceMs
      )

    const totalAmountCents = roundCents(
      tips.reduce((sum, tip) => sum + tip.amountCents, 0)
    )
    const topHighlights = groupByHighlight(tips)
      .sort((a, b) => b.totalAmountCents - a.totalAmountCents)
      .slice(0, 10)

    return {
      totalTips: tips.length,
      totalAmountCents,
      totalAmountUsd: totalAmountCents / 100,
      uniqueTippers: new Set(tips.map((tip) => tip.tipperId)).size,
      topHighlights,
      byVersion: countByVersion(tips),
      grossBaseUnits: sumBaseUnitsByToken(tips),
      complete,
    }
  },
})

type HighlightGroup = {
  highlightId: string
  text: string
  startOffset: number
  endOffset: number
  totalAmountCents: number
  tipCount: number
  grossBaseUnits: Record<string, string>
}

function groupByHighlight(tips: Doc<'highlightTips'>[]): HighlightGroup[] {
  const groups = new Map<
    string,
    { group: HighlightGroup; rows: Doc<'highlightTips'>[] }
  >()
  for (const tip of tips) {
    let entry = groups.get(tip.highlightId)
    if (!entry) {
      entry = {
        group: {
          highlightId: tip.highlightId,
          text: tip.highlightText,
          startOffset: tip.startOffset,
          endOffset: tip.endOffset,
          totalAmountCents: 0,
          tipCount: 0,
          grossBaseUnits: {},
        },
        rows: [],
      }
      groups.set(tip.highlightId, entry)
    }
    entry.group.totalAmountCents = roundCents(
      entry.group.totalAmountCents + tip.amountCents
    )
    entry.group.tipCount += 1
    entry.rows.push(tip)
  }
  return [...groups.values()].map(({ group, rows }) => ({
    ...group,
    grossBaseUnits: sumBaseUnitsByToken(rows),
  }))
}
