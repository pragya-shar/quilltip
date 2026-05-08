import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import {
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  HORIZON_VERIFY_INITIAL_DELAY_MS,
} from './lib/constants'
import { enforceTipCooldown } from './lib/rateLimit'

/**
 * Create a new highlight tip after Stellar transaction
 */
export const create = mutation({
  args: {
    highlightId: v.string(),
    articleId: v.id('articles'),
    highlightText: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.optional(v.string()),
    endContainerPath: v.optional(v.string()),
    amountCents: v.number(),
    stellarTxId: v.string(),
    stellarMemo: v.string(),
    stellarNetwork: v.optional(v.string()),
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    stellarSourceAccount: v.optional(v.string()),
    stellarDestinationAccount: v.optional(v.string()),
    stellarAmountXlm: v.optional(v.string()),
    contractTipId: v.optional(v.string()),
    platformFee: v.optional(v.number()),
    authorShare: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Get user data
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    // Get article data
    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')

    // Get author data
    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Author not found')

    // Validate highlight text length
    if (args.highlightText.length > 5000) {
      throw new Error('Highlight text too long (max 5000 characters)')
    }

    // Validate tip amount (must be between $0.01 and $100)
    if (
      !Number.isFinite(args.amountCents) ||
      args.amountCents < TIP_MIN_CENTS ||
      args.amountCents > TIP_MAX_CENTS
    ) {
      throw new Error(
        `Tip amount must be between $${(TIP_MIN_CENTS / 100).toFixed(2)} and $${(TIP_MAX_CENTS / 100).toFixed(0)}`
      )
    }

    // Dedup: Convex mutations have at-least-once delivery, so a lost ack
    // could cause the client to retry and insert a duplicate row. Non-empty
    // stellarTxIds are unique per Stellar transaction, so we look up by index
    // and return the existing row if found. Empty stellarTxIds are not deduped
    // because two unrelated tips could legitimately share that sentinel value.
    //
    // We additionally require highlightId, articleId, and tipperId to match
    // the existing row before short-circuiting. A txId reused across a
    // different highlight or by a different user is never a legit retry —
    // silently returning the mismatched original would tell the caller "your
    // tip succeeded" when in fact no tip on the requested highlight was
    // created. Reject explicitly.
    if (args.stellarTxId !== '') {
      const existing = await ctx.db
        .query('highlightTips')
        .withIndex('by_stellar_tx', (q) =>
          q.eq('stellarTxId', args.stellarTxId)
        )
        .first()
      if (existing) {
        if (
          existing.highlightId === args.highlightId &&
          existing.articleId === args.articleId &&
          existing.tipperId === userId
        ) {
          return existing._id
        }
        throw new ConvexError(
          'This Stellar transaction is already linked to a different tip.'
        )
      }
    }

    // Cooldown check runs after the dedup short-circuit so that at-least-once
    // retries of the same Stellar tx are not mistaken for spam.
    await enforceTipCooldown(ctx, userId)

    const amountUsd = args.amountCents / 100
    const now = Date.now()

    // Insert tip as PENDING. Counter updates and author-stat bumps intentionally
    // live in internal.stellarVerify.markHighlightTipConfirmed so that we only
    // credit the author once Horizon confirms the on-chain tx is real.
    const highlightTipId = await ctx.db.insert('highlightTips', {
      highlightId: args.highlightId,
      articleId: args.articleId,
      tipperId: userId,
      authorId: article.authorId,

      highlightText: args.highlightText,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: user.name,
      tipperAvatar: user.avatar,
      authorName: author.name,
      authorAvatar: author.avatar,

      amountUsd,
      amountCents: args.amountCents,

      stellarTxId: args.stellarTxId,
      stellarNetwork: args.stellarNetwork || 'TESTNET',
      stellarMemo: args.stellarMemo,
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: args.stellarSourceAccount,
      stellarDestinationAccount: args.stellarDestinationAccount,
      stellarAmountXlm: args.stellarAmountXlm,
      contractTipId: args.contractTipId,

      startOffset: args.startOffset,
      endOffset: args.endOffset,
      startContainerPath: args.startContainerPath,
      endContainerPath: args.endContainerPath,

      status: 'PENDING',
      platformFee: args.platformFee,
      authorShare: args.authorShare,

      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })

    await ctx.scheduler.runAfter(
      HORIZON_VERIFY_INITIAL_DELAY_MS,
      internal.stellarVerify.verifyHighlightTip,
      { highlightTipId, attempt: 1 }
    )

    return highlightTipId
  },
})

/**
 * Get all tips for a specific highlight. Only CONFIRMED tips are returned;
 * PENDING tips (awaiting Horizon verification) and FAILED tips are excluded.
 */
export const getByHighlight = query({
  args: {
    highlightId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_highlight', (q) => q.eq('highlightId', args.highlightId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()
  },
})

/**
 * Get all highlight tips for an article (for heatmap). Only CONFIRMED tips
 * are returned so the heatmap never shows tips that ultimately failed
 * verification.
 */
export const getByArticle = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()
  },
})

/**
 * Get highlight tips by tipper (the caller's tipping history). Intentionally
 * returns rows in every status (PENDING / CONFIRMED / FAILED) so the tipper
 * sees in-flight and rejected tips in their own history — do NOT add a
 * `status === 'CONFIRMED'` filter here. Public-facing aggregations (heatmap,
 * author earnings) have their own CONFIRMED-only filters.
 */
export const getByTipper = query({
  args: {
    tipperId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', args.tipperId))
      .order('desc')
      .collect()
  },
})

/**
 * Get highlight tips received by author. PENDING/FAILED tips are excluded —
 * mirrors tips.getUserReceivedTips so authors only see verified earnings.
 */
export const getByAuthor = query({
  args: {
    authorId: v.id('users'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', args.authorId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .order('desc')
      .collect()
  },
})

/**
 * Get aggregate stats for an article's highlight tips. PENDING and FAILED
 * tips are excluded so the numbers match what the heatmap displays.
 */
export const getArticleStats = query({
  args: {
    articleId: v.id('articles'),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let tipsQuery = ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))

    if (args.sinceMs !== undefined) {
      tipsQuery = tipsQuery.filter((q) =>
        q.gte(q.field('createdAt'), args.sinceMs!)
      )
    }

    const tips = await tipsQuery.collect()

    const totalTips = tips.length
    const totalAmountCents = tips.reduce((sum, tip) => sum + tip.amountCents, 0)
    const uniqueTippers = new Set(tips.map((tip) => tip.tipperId)).size

    // Group by highlight ID to find most tipped highlights
    type HighlightGroup = {
      highlightId: string
      text: string
      startOffset: number
      endOffset: number
      totalAmountCents: number
      tipCount: number
    }

    const highlightGroups = tips.reduce(
      (acc, tip) => {
        if (!acc[tip.highlightId]) {
          acc[tip.highlightId] = {
            highlightId: tip.highlightId,
            text: tip.highlightText,
            startOffset: tip.startOffset,
            endOffset: tip.endOffset,
            totalAmountCents: 0,
            tipCount: 0,
          }
        }
        const group = acc[tip.highlightId]!
        group.totalAmountCents += tip.amountCents
        group.tipCount += 1
        return acc
      },
      {} as Record<string, HighlightGroup>
    )

    const topHighlights = Object.values(highlightGroups)
      .sort((a, b) => b.totalAmountCents - a.totalAmountCents)
      .slice(0, 10)

    return {
      totalTips,
      totalAmountCents,
      totalAmountUsd: totalAmountCents / 100,
      uniqueTippers,
      topHighlights,
    }
  },
})
