import { syncReadingRoomEngagement } from './lib/readingRoomIndex'
import { verifiedTipFilter } from './lib/verifiedTips'
import { getTipArticleSummary } from './lib/tipArticleSummary'
import { ConvexError, v } from 'convex/values'
import { query, mutation, internalMutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import { enrichWithUser } from './lib/enrich'
import {
  HORIZON_VERIFY_INITIAL_DELAY_MS,
  ARTICLE_TIP_VERIFY_REQUEST_COOLDOWN_MS,
  getStellarNetwork,
  getTippingContractId,
} from './lib/constants'
import { checkTipCooldown, enforceTipCooldown } from './lib/rateLimit'
import {
  ARTICLE_TIP_FALLBACK_XLM_USD_RATE,
  ARTICLE_TIP_INTENT_TTL_MS,
  articleTipIntentTimeBoundsServer,
  quoteTipAmount,
  tipXlmPresetValidator,
  validateTipAmount,
  shortArticleIdServer,
} from './lib/articleTipExpectation'
import { MAX_PRICE_AGE_MS } from './xlmPrice'
import { getMonthKey, roundCents, writerShareCents } from './lib/authorEarnings'

const MAX_OUTSTANDING_ARTICLE_TIP_INTENTS = 5

// Get tips for an article
export const getArticleTips = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter(verifiedTipFilter)
      .order('desc')
      .collect()

    // Enrich with tipper data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => ({
        ...tip,
        tipper: await enrichWithUser(ctx, tip.tipperId),
      }))
    )

    return enrichedTips
  },
})

// Get tip statistics for an article
export const getArticleTipStats = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter(verifiedTipFilter)
      .collect()

    const totalTips = tips.length
    const totalAmountUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const uniqueTippers = new Set(tips.map((tip) => tip.tipperId)).size

    return {
      totalTips,
      totalAmountUsd,
      uniqueTippers,
    }
  },
})

// Get the caller's full tip history. Intentionally returns rows in every status
// (PENDING / CONFIRMED / FAILED / FRAUDULENT) so the tipper sees in-flight and
// rejected tips in their own history — do NOT add a `status === 'CONFIRMED'`
// filter here. Public-facing aggregations (article counters, leaderboards)
// have their own CONFIRMED-only filters.
export const getUserSentTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const tips = await ctx.db
      .query('tips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', userId))
      .order('desc')
      .collect()

    // Enrich with article data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => {
        const article = await ctx.db.get(tip.articleId)
        return {
          ...tip,
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

    return enrichedTips
  },
})

// Get user's received tips
export const getUserReceivedTips = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return []

    const tips = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter(verifiedTipFilter)
      .order('desc')
      .collect()

    // Enrich with tipper and article data
    const enrichedTips = await Promise.all(
      tips.map(async (tip) => {
        const [tipper, article] = await Promise.all([
          enrichWithUser(ctx, tip.tipperId),
          ctx.db.get(tip.articleId),
        ])

        return {
          ...tip,
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

    return enrichedTips
  },
})

// Pre-flight cooldown check used by the UI before starting the Stellar signing
// flow. Returning { allowed: true } for unauthenticated callers keeps anonymous
// page views from ever seeing a false rate-limit signal; the sendTip mutation
// still requires authentication as usual.
export const canTip = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return { allowed: true as const }
    return await checkTipCooldown(ctx, userId)
  },
})

export const prepareArticleTip = mutation({
  args: {
    articleId: v.id('articles'),
    amountCents: v.optional(v.number()),
    amountXlm: v.optional(tipXlmPresetValidator),
    message: v.optional(v.string()),
    stellarSourceAccount: v.string(),
  },
  returns: v.object({
    intentId: v.id('articleTipIntents'),
    articleSymbol: v.string(),
    authorAddress: v.string(),
    amountStroops: v.number(),
    amountCents: v.number(),
    stellarNetwork: v.union(v.literal('TESTNET'), v.literal('MAINNET')),
    contractId: v.string(),
    timeBounds: v.object({
      minTime: v.string(),
      maxTime: v.string(),
    }),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const amount = validateTipAmount(args)
    const { amountCents: usdCents, amountXlm } = amount
    if (args.message && args.message.length > 500) {
      throw new Error('Message must be 500 characters or less')
    }
    if (!/^G[A-Z2-7]{55}$/.test(args.stellarSourceAccount)) {
      throw new Error('Invalid Stellar source account')
    }

    const [tipper, article] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(args.articleId),
    ])
    if (!tipper) throw new Error('User not found')
    if (!article || !article.published) throw new Error('Article not found')

    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Author not found')
    if (!author.stellarAddress || typeof author.stellarAddress !== 'string') {
      throw new Error('Author has not configured a receiving wallet')
    }

    const now = Date.now()
    const expectedArticleSymbol = await shortArticleIdServer(
      args.articleId.toString()
    )
    const expectedStellarNetwork = getStellarNetwork()
    const expectedContractId = getTippingContractId()
    const outstanding = await ctx.db
      .query('articleTipIntents')
      .withIndex('by_tipper_expiry', (q) =>
        q.eq('tipperId', userId).gt('expiresAt', now)
      )
      .collect()
    const unlinked = outstanding.filter((intent) => !intent.tipId)
    const reusable = unlinked.find(
      (intent) =>
        intent.articleId === args.articleId &&
        intent.authorId === article.authorId &&
        intent.articleTitle === article.title &&
        intent.articleSlug === article.slug &&
        intent.amountXlm === amountXlm &&
        (amountXlm !== undefined || intent.amountCents === usdCents) &&
        intent.message === args.message &&
        intent.expectedSourceAccount === args.stellarSourceAccount &&
        intent.expectedDestinationAccount === author.stellarAddress &&
        intent.expectedArticleSymbol === expectedArticleSymbol &&
        intent.expectedStellarNetwork === expectedStellarNetwork &&
        intent.expectedContractId === expectedContractId &&
        typeof intent.expectedMinTime === 'string' &&
        typeof intent.expectedMaxTime === 'string'
    )
    if (reusable) {
      return {
        intentId: reusable._id,
        articleSymbol: reusable.expectedArticleSymbol,
        authorAddress: reusable.expectedDestinationAccount,
        amountStroops: Number(reusable.expectedAmountStroops),
        amountCents: reusable.amountCents,
        stellarNetwork: expectedStellarNetwork,
        contractId: expectedContractId,
        timeBounds: {
          minTime: reusable.expectedMinTime!,
          maxTime: reusable.expectedMaxTime!,
        },
      }
    }
    if (unlinked.length >= MAX_OUTSTANDING_ARTICLE_TIP_INTENTS) {
      throw new ConvexError('Too many outstanding article tip intents')
    }

    const cachedRate = await ctx.db.query('xlmPriceCache').first()
    const useCachedRate =
      cachedRate !== null && now - cachedRate.fetchedAt <= MAX_PRICE_AGE_MS
    const quotePriceUsd = useCachedRate
      ? cachedRate.priceUsd
      : ARTICLE_TIP_FALLBACK_XLM_USD_RATE
    const quoteSource = useCachedRate ? cachedRate.source : 'Fallback'
    const quoteFetchedAt = useCachedRate ? cachedRate.fetchedAt : now
    const { amountCents, expectedAmountStroops } = quoteTipAmount(
      amount,
      quotePriceUsd
    )
    const expiresAt = now + ARTICLE_TIP_INTENT_TTL_MS

    const intentId = await ctx.db.insert('articleTipIntents', {
      articleId: args.articleId,
      tipperId: userId,
      authorId: article.authorId,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: tipper.name || tipper.username,
      tipperAvatar: tipper.avatar,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      amountUsd: amountCents / 100,
      amountCents,
      amountXlm,
      message: args.message,
      expectedSourceAccount: args.stellarSourceAccount,
      expectedDestinationAccount: author.stellarAddress,
      expectedArticleSymbol,
      expectedAmountStroops: expectedAmountStroops.toString(),
      expectedStellarNetwork,
      expectedContractId,
      quotePriceUsd,
      quoteSource,
      quoteFetchedAt,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    const expectedTimeBounds = await articleTipIntentTimeBoundsServer(
      intentId,
      expiresAt
    )
    await ctx.db.patch(intentId, {
      expectedMinTime: expectedTimeBounds.minTime,
      expectedMaxTime: expectedTimeBounds.maxTime,
    })

    return {
      intentId,
      articleSymbol: expectedArticleSymbol,
      authorAddress: author.stellarAddress,
      amountStroops: expectedAmountStroops,
      amountCents,
      stellarNetwork: expectedStellarNetwork,
      contractId: expectedContractId,
      timeBounds: expectedTimeBounds,
    }
  },
})

export const submitArticleTip = mutation({
  args: {
    intentId: v.id('articleTipIntents'),
    stellarTxId: v.string(),
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    contractTipId: v.optional(v.string()),
  },
  returns: v.id('tips'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    if (!args.stellarTxId.trim()) {
      throw new Error('A Stellar transaction hash is required')
    }

    const intent = await ctx.db.get(args.intentId)
    if (!intent || intent.tipperId !== userId) {
      throw new Error('Article tip intent not found')
    }

    if (intent.tipId) {
      const existingForIntent = await ctx.db.get(intent.tipId)
      if (
        existingForIntent &&
        existingForIntent.stellarTxId === args.stellarTxId
      ) {
        return existingForIntent._id
      }
      throw new ConvexError(
        'This article tip intent is already linked to a different transaction.'
      )
    }
    const existingForHash = await ctx.db
      .query('tips')
      .withIndex('by_stellar_tx', (q) => q.eq('stellarTxId', args.stellarTxId))
      .first()
    if (existingForHash) {
      if (
        existingForHash.articleTipIntentId === args.intentId &&
        existingForHash.tipperId === userId
      ) {
        await ctx.db.patch(args.intentId, {
          tipId: existingForHash._id,
          updatedAt: Date.now(),
        })
        return existingForHash._id
      }
      throw new ConvexError(
        'This Stellar transaction is already linked to a different tip.'
      )
    }

    await enforceTipCooldown(ctx, userId)

    const now = Date.now()
    const tipId = await ctx.db.insert('tips', {
      articleId: intent.articleId,
      articleTitle: intent.articleTitle,
      articleSlug: intent.articleSlug,
      tipperId: intent.tipperId,
      tipperName: intent.tipperName,
      tipperAvatar: intent.tipperAvatar,
      authorId: intent.authorId,
      authorName: intent.authorName,
      authorAvatar: intent.authorAvatar,
      amountUsd: intent.amountUsd,
      amountCents: intent.amountCents,
      message: intent.message,
      stellarTxId: args.stellarTxId,
      stellarNetwork: intent.expectedStellarNetwork ?? getStellarNetwork(),
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: intent.expectedSourceAccount,
      stellarDestinationAccount: intent.expectedDestinationAccount,
      stellarAmountXlm: (
        Number(intent.expectedAmountStroops) / 10_000_000
      ).toString(),
      contractTipId: args.contractTipId,
      articleTipIntentId: intent._id,
      expectedSourceAccount: intent.expectedSourceAccount,
      expectedDestinationAccount: intent.expectedDestinationAccount,
      expectedArticleSymbol: intent.expectedArticleSymbol,
      expectedAmountStroops: intent.expectedAmountStroops,
      expectedContractId: intent.expectedContractId,
      expectedMinTime: intent.expectedMinTime,
      expectedMaxTime: intent.expectedMaxTime,
      quotePriceUsd: intent.quotePriceUsd,
      quoteSource: intent.quoteSource,
      quoteFetchedAt: intent.quoteFetchedAt,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(args.intentId, { tipId, updatedAt: now })
    await ctx.scheduler.runAfter(
      HORIZON_VERIFY_INITIAL_DELAY_MS,
      internal.articleTipVerify.verifyArticleTip,
      { tipId, attempt: 1 }
    )
    return tipId
  },
})

export const getArticleTipStatus = query({
  args: { tipId: v.id('tips') },
  returns: v.object({
    status: v.string(),
    failureReason: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.tipperId !== userId || !tip.articleTipIntentId) {
      throw new Error('Article tip not found')
    }
    return {
      status: tip.status,
      failureReason: tip.failureReason,
      verifiedAt: tip.verifiedAt,
    }
  },
})

export const retryArticleTipVerification = mutation({
  args: { tipId: v.id('tips') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.tipperId !== userId || !tip.articleTipIntentId) {
      throw new Error('Article tip not found')
    }
    if (tip.status !== 'PENDING') {
      throw new Error('Only pending article tips can be retried')
    }

    const now = Date.now()
    if (
      tip.verificationRequestedAt !== undefined &&
      now - tip.verificationRequestedAt < ARTICLE_TIP_VERIFY_REQUEST_COOLDOWN_MS
    ) {
      return null
    }

    await ctx.db.patch(args.tipId, {
      verificationRequestedAt: now,
      failureReason: undefined,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(
      0,
      internal.articleTipVerify.verifyArticleTip,
      { tipId: args.tipId, attempt: 1 }
    )
    return null
  },
})

// Compatibility stub for clients that still call the retired unverified path.
// Keeping the public function name produces a clear migration error without
// retaining any client-owned financial write logic.
export const sendTip = mutation({
  args: {
    articleId: v.id('articles'),
    amountUsd: v.number(),
    message: v.optional(v.string()),
    stellarTxId: v.string(),
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
  returns: v.id('tips'),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    throw new Error(
      'Legacy article tip submission is disabled; prepare and submit a verified article tip instead.'
    )
  },
})

// Internal mutation: mark a previously-CONFIRMED tip as FRAUDULENT and reverse
// every counter/earnings increment that confirmation applied. Called exclusively
// by the reconciliation action when on-chain verification proves the tip was
// faked (e.g., no matching Stellar tx, wrong contract, wrong recipient).
//
// Idempotent: safe to call twice on the same tip; the second call is a no-op.
// Guarded: only reverses CONFIRMED tips. PENDING/FAILED tips never had counters
// credited, so reversal would decrement into negatives.
export const markArticleTipFraudulent = internalMutation({
  args: {
    tipId: v.id('tips'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const tip = await ctx.db.get(args.tipId)
    if (!tip) return
    if (tip.status === 'FRAUDULENT') return
    if (tip.status !== 'CONFIRMED') {
      console.warn(
        '[reconcileTips] markArticleTipFraudulent skipped: tip not CONFIRMED',
        { tipId: args.tipId, currentStatus: tip.status }
      )
      return
    }

    const now = Date.now()

    // Flip tip status + record reason
    await ctx.db.patch(args.tipId, {
      status: 'FRAUDULENT',
      failureReason: args.reason,
      processedAt: now,
      updatedAt: now,
    })

    // Reverse article counters
    const article = await ctx.db.get(tip.articleId)
    if (article) {
      const tipCount = Math.max(0, (article.tipCount || 0) - 1)
      await ctx.db.patch(tip.articleId, {
        tipCount,
        totalTipsUsd: Math.max(0, (article.totalTipsUsd || 0) - tip.amountUsd),
      })
      await syncReadingRoomEngagement(ctx, tip.articleId, { tipCount })
    }

    // Reverse authorEarnings
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', tip.authorId))
      .first()

    if (!earnings) {
      console.warn(
        '[reconcileTips] markArticleTipFraudulent: no authorEarnings row for CONFIRMED tip; skipping earnings reversal',
        { tipId: args.tipId, authorId: tip.authorId }
      )
    } else {
      // Remove the same writer share that confirmation credited.
      const shareCents = writerShareCents(
        tip.amountCents,
        tip.expectedAmountStroops
      )
      const shareUsd = shareCents / 100
      const monthKey = getMonthKey(tip.createdAt)
      const monthlyEarnings = { ...(earnings.monthlyEarnings || {}) }
      const newMonthlyValue = Math.max(
        0,
        (monthlyEarnings[monthKey] || 0) - shareUsd
      )
      if (newMonthlyValue === 0) {
        delete monthlyEarnings[monthKey]
      } else {
        monthlyEarnings[monthKey] = newMonthlyValue
      }

      // Reverse topArticles entry. If both earnings and tipCount hit zero,
      // drop the entry entirely. Re-sort descending but do not re-splice to
      // top 10: a decrement here could have pushed a hidden article into
      // range, but we cannot recover that state from this code path.
      const topArticles = [...(earnings.topArticles || [])]
      const articleIndex = topArticles.findIndex(
        (a) => a.articleId === tip.articleId
      )
      if (articleIndex >= 0 && topArticles[articleIndex]) {
        const entry = topArticles[articleIndex]
        const newEarnings = Math.max(0, entry.earnings - shareUsd)
        const newTipCount = Math.max(0, entry.tipCount - 1)
        if (newEarnings === 0 && newTipCount === 0) {
          topArticles.splice(articleIndex, 1)
        } else {
          entry.earnings = newEarnings
          entry.tipCount = newTipCount
        }
        topArticles.sort((a, b) => b.earnings - a.earnings)
      }

      const newTotalCents = Math.max(
        0,
        roundCents(earnings.totalEarnedCents - shareCents)
      )
      const newAvailableCents = Math.max(
        0,
        roundCents(earnings.availableBalanceCents - shareCents)
      )
      await ctx.db.patch(earnings._id, {
        totalEarnedCents: newTotalCents,
        totalEarnedUsd: newTotalCents / 100,
        availableBalanceCents: newAvailableCents,
        availableBalanceUsd: newAvailableCents / 100,
        tipCount: Math.max(0, earnings.tipCount - 1),
        monthlyEarnings,
        topArticles,
        updatedAt: now,
      })
    }

    // Reverse user stats
    const [tipper, author] = await Promise.all([
      ctx.db.get(tip.tipperId),
      ctx.db.get(tip.authorId),
    ])

    if (tipper) {
      await ctx.db.patch(tip.tipperId, {
        tipsSentCount: Math.max(0, (tipper.tipsSentCount || 0) - 1),
      })
    }

    if (author) {
      await ctx.db.patch(tip.authorId, {
        tipsReceivedCount: Math.max(0, (author.tipsReceivedCount || 0) - 1),
      })
    }

    console.error('[reconcileTips] marked FRAUDULENT', {
      tipId: args.tipId,
      articleId: tip.articleId,
      tipperId: tip.tipperId,
      authorId: tip.authorId,
      amountUsd: tip.amountUsd,
      reason: args.reason,
    })

    return { success: true }
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

const STROOPS_PER_XLM = BigInt(10_000_000)
const PLATFORM_FEE_BPS = BigInt(250)
const BPS_DENOMINATOR = BigInt(10_000)

function writerShareStroops(tip: {
  expectedAmountStroops?: string
  stellarAmountXlm?: string
}): bigint | null {
  let stroops: bigint | null = null
  if (
    tip.expectedAmountStroops &&
    /^[1-9]\d*$/.test(tip.expectedAmountStroops)
  ) {
    stroops = BigInt(tip.expectedAmountStroops)
  } else if (
    tip.stellarAmountXlm &&
    /^\d+(\.\d{1,7})?$/.test(tip.stellarAmountXlm)
  ) {
    const [whole, fraction = ''] = tip.stellarAmountXlm.split('.')
    stroops =
      BigInt(whole ?? '0') * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, '0'))
  }
  if (!stroops || stroops <= BigInt(0)) return null
  return stroops - (stroops * PLATFORM_FEE_BPS) / BPS_DENOMINATOR
}

// The caller's verified earnings as a writer: the XLM writer share actually
// paid on chain plus the USD estimate recorded at tip time. The network is
// returned so the UI can label testnet amounts as having no real value.
export const getMyEarningsSummary = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      network: v.union(v.literal('TESTNET'), v.literal('MAINNET')),
      tipCount: v.number(),
      writerShareStroops: v.string(),
      estimatedUsd: v.number(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const [articleTips, passageTips] = await Promise.all([
      ctx.db
        .query('tips')
        .withIndex('by_author', (q) => q.eq('authorId', userId))
        .filter(verifiedTipFilter)
        .collect(),
      ctx.db
        .query('highlightTips')
        .withIndex('by_author', (q) => q.eq('authorId', userId))
        .filter(verifiedTipFilter)
        .collect(),
    ])
    let stroops = BigInt(0)
    let cents = 0
    for (const tip of [...articleTips, ...passageTips]) {
      stroops += writerShareStroops(tip) ?? BigInt(0)
      if (!('amountUsdSuspicious' in tip && tip.amountUsdSuspicious)) {
        cents += writerShareCents(tip.amountCents, tip.expectedAmountStroops)
      }
    }
    return {
      network: getStellarNetwork(),
      tipCount: articleTips.length + passageTips.length,
      writerShareStroops: stroops.toString(),
      estimatedUsd: roundCents(cents) / 100,
    }
  },
})
