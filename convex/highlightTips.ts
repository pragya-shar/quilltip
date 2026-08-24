import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { StrKey } from '@stellar/stellar-sdk'
import { internal } from './_generated/api'
import {
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  HORIZON_VERIFY_INITIAL_DELAY_MS,
  getStellarNetwork,
  getTippingContractId,
} from './lib/constants'
import { enforceTipCooldown } from './lib/rateLimit'
import {
  ARTICLE_TIP_FALLBACK_XLM_USD_RATE,
  ARTICLE_TIP_INTENT_TTL_MS,
  articleTipIntentTimeBoundsServer,
  calculateTipStroops,
  shortArticleIdServer,
} from './lib/articleTipExpectation'
import { generateHighlightIdServer } from './lib/highlightHash'
import { extractTextFromTiptapJson } from './lib/tiptapContent'
import { MAX_PRICE_AGE_MS } from './xlmPrice'
import {
  normalizeStellarTransactionHash,
  stellarTransactionHashLookupValues,
} from './lib/stellarTransactionHash'

const MAX_OUTSTANDING_HIGHLIGHT_TIP_INTENTS = 5
const MAX_HIGHLIGHT_CONTAINER_PATH_LENGTH = 256

function stroopsToXlm(stroops: string): string {
  const padded = stroops.padStart(8, '0')
  const whole = padded.slice(0, -7)
  const fraction = padded.slice(-7).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function normalizePlainText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function isValidHighlightContainerPath(path: string | undefined): boolean {
  return (
    path === undefined ||
    (path.length <= MAX_HIGHLIGHT_CONTAINER_PATH_LENGTH &&
      /^\d+(?:\.\d+)*$/.test(path))
  )
}

export const prepareHighlightTip = mutation({
  args: {
    articleId: v.id('articles'),
    highlightText: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.optional(v.string()),
    endContainerPath: v.optional(v.string()),
    amountCents: v.number(),
    message: v.optional(v.string()),
    stellarSourceAccount: v.string(),
  },
  returns: v.object({
    intentId: v.id('highlightTipIntents'),
    highlightId: v.string(),
    articleSymbol: v.string(),
    authorAddress: v.string(),
    amountStroops: v.number(),
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

    if (
      !Number.isSafeInteger(args.amountCents) ||
      args.amountCents < TIP_MIN_CENTS ||
      args.amountCents > TIP_MAX_CENTS
    ) {
      throw new Error('Invalid tip amount')
    }
    if (!args.highlightText.trim() || args.highlightText.length > 5000) {
      throw new Error('Invalid highlight text')
    }
    if (
      !Number.isSafeInteger(args.startOffset) ||
      !Number.isSafeInteger(args.endOffset) ||
      args.startOffset < 0 ||
      args.endOffset <= args.startOffset
    ) {
      throw new Error('Invalid highlight selection bounds')
    }
    if (
      !isValidHighlightContainerPath(args.startContainerPath) ||
      !isValidHighlightContainerPath(args.endContainerPath)
    ) {
      throw new Error('Invalid highlight container path')
    }
    if (args.message && args.message.length > 500) {
      throw new Error('Message must be 500 characters or less')
    }
    if (!StrKey.isValidEd25519PublicKey(args.stellarSourceAccount)) {
      throw new Error('Invalid Stellar source account')
    }

    const [tipper, article] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(args.articleId),
    ])
    if (!tipper) throw new Error('User not found')
    if (!article) throw new Error('Article not found')

    const articlePlainText = extractTextFromTiptapJson(article.content)
    if (args.endOffset > articlePlainText.length) {
      throw new Error('Invalid highlight selection bounds')
    }
    if (
      !normalizePlainText(articlePlainText).includes(
        normalizePlainText(args.highlightText)
      )
    ) {
      throw new Error('Highlight text does not match article content')
    }

    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Author not found')
    if (
      !author.stellarAddress ||
      typeof author.stellarAddress !== 'string' ||
      !StrKey.isValidEd25519PublicKey(author.stellarAddress)
    ) {
      throw new Error('Author has not configured a valid receiving wallet')
    }

    const now = Date.now()
    const expectedHighlightId = await generateHighlightIdServer(
      article.slug,
      args.highlightText,
      args.startOffset,
      args.endOffset
    )
    const expectedArticleSymbol = await shortArticleIdServer(
      args.articleId.toString()
    )
    const expectedStellarNetwork = getStellarNetwork()
    const expectedContractId = getTippingContractId()
    const outstanding = await ctx.db
      .query('highlightTipIntents')
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
        intent.highlightText === args.highlightText &&
        intent.startOffset === args.startOffset &&
        intent.endOffset === args.endOffset &&
        intent.startContainerPath === args.startContainerPath &&
        intent.endContainerPath === args.endContainerPath &&
        intent.amountCents === args.amountCents &&
        intent.message === args.message &&
        intent.expectedSourceAccount === args.stellarSourceAccount &&
        intent.expectedDestinationAccount === author.stellarAddress &&
        intent.expectedHighlightId === expectedHighlightId &&
        intent.expectedArticleSymbol === expectedArticleSymbol &&
        intent.expectedStellarNetwork === expectedStellarNetwork &&
        intent.expectedContractId === expectedContractId
    )
    if (reusable) {
      return {
        intentId: reusable._id,
        highlightId: reusable.expectedHighlightId,
        articleSymbol: reusable.expectedArticleSymbol,
        authorAddress: reusable.expectedDestinationAccount,
        amountStroops: Number(reusable.expectedAmountStroops),
        stellarNetwork: reusable.expectedStellarNetwork,
        contractId: reusable.expectedContractId,
        timeBounds: {
          minTime: reusable.expectedMinTime,
          maxTime: reusable.expectedMaxTime,
        },
      }
    }
    if (unlinked.length >= MAX_OUTSTANDING_HIGHLIGHT_TIP_INTENTS) {
      throw new ConvexError('Too many outstanding highlight tip intents')
    }

    const cachedRate = await ctx.db.query('xlmPriceCache').first()
    const useCachedRate =
      cachedRate !== null && now - cachedRate.fetchedAt <= MAX_PRICE_AGE_MS
    const quotePriceUsd = useCachedRate
      ? cachedRate.priceUsd
      : ARTICLE_TIP_FALLBACK_XLM_USD_RATE
    const quoteSource = useCachedRate ? cachedRate.source : 'Fallback'
    const quoteFetchedAt = useCachedRate ? cachedRate.fetchedAt : now
    const expectedAmountStroops = calculateTipStroops(
      args.amountCents,
      quotePriceUsd
    )
    const expiresAt = now + ARTICLE_TIP_INTENT_TTL_MS
    const intentId = await ctx.db.insert('highlightTipIntents', {
      articleId: args.articleId,
      tipperId: userId,
      authorId: article.authorId,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: tipper.name || tipper.username,
      tipperAvatar: tipper.avatar,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      highlightText: args.highlightText,
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      startContainerPath: args.startContainerPath,
      endContainerPath: args.endContainerPath,
      amountUsd: args.amountCents / 100,
      amountCents: args.amountCents,
      message: args.message,
      expectedSourceAccount: args.stellarSourceAccount,
      expectedDestinationAccount: author.stellarAddress,
      expectedHighlightId,
      expectedArticleSymbol,
      expectedAmountStroops: expectedAmountStroops.toString(),
      expectedContractId,
      expectedMinTime: '',
      expectedMaxTime: '',
      expectedStellarNetwork,
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
      highlightId: expectedHighlightId,
      articleSymbol: expectedArticleSymbol,
      authorAddress: author.stellarAddress,
      amountStroops: expectedAmountStroops,
      stellarNetwork: expectedStellarNetwork,
      contractId: expectedContractId,
      timeBounds: expectedTimeBounds,
    }
  },
})

export const submitHighlightTip = mutation({
  args: {
    intentId: v.id('highlightTipIntents'),
    stellarTxId: v.string(),
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    contractTipId: v.optional(v.string()),
  },
  returns: v.id('highlightTips'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const stellarTxId = normalizeStellarTransactionHash(args.stellarTxId)
    if (!stellarTxId) {
      throw new Error('Invalid Stellar transaction hash')
    }

    const intent = await ctx.db.get(args.intentId)
    if (!intent || intent.tipperId !== userId) {
      throw new Error('Highlight tip intent not found')
    }
    if (intent.tipId) {
      const existingForIntent = await ctx.db.get(intent.tipId)
      if (
        existingForIntent &&
        normalizeStellarTransactionHash(existingForIntent.stellarTxId) ===
          stellarTxId
      ) {
        return existingForIntent._id
      }
      throw new ConvexError(
        'This highlight tip intent is already linked to a different transaction.'
      )
    }

    const existingForHashes = (
      await Promise.all(
        stellarTransactionHashLookupValues(stellarTxId).map((lookupValue) =>
          ctx.db
            .query('highlightTips')
            .withIndex('by_stellar_tx', (q) => q.eq('stellarTxId', lookupValue))
            .collect()
        )
      )
    ).flat()
    if (existingForHashes.length > 0) {
      const existingForHash = existingForHashes[0]!
      if (
        existingForHashes.length === 1 &&
        existingForHash.highlightTipIntentId === args.intentId &&
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
    const tipId = await ctx.db.insert('highlightTips', {
      highlightId: intent.expectedHighlightId,
      articleId: intent.articleId,
      tipperId: intent.tipperId,
      authorId: intent.authorId,
      highlightText: intent.highlightText,
      articleTitle: intent.articleTitle,
      articleSlug: intent.articleSlug,
      tipperName: intent.tipperName,
      tipperAvatar: intent.tipperAvatar,
      authorName: intent.authorName,
      authorAvatar: intent.authorAvatar,
      amountUsd: intent.amountUsd,
      amountCents: intent.amountCents,
      message: intent.message,
      stellarTxId,
      stellarNetwork: intent.expectedStellarNetwork,
      stellarMemo: intent.expectedHighlightId,
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: intent.expectedSourceAccount,
      stellarDestinationAccount: intent.expectedDestinationAccount,
      stellarAmountXlm: stroopsToXlm(intent.expectedAmountStroops),
      contractTipId: args.contractTipId,
      highlightTipIntentId: intent._id,
      expectedSourceAccount: intent.expectedSourceAccount,
      expectedDestinationAccount: intent.expectedDestinationAccount,
      expectedHighlightId: intent.expectedHighlightId,
      expectedArticleSymbol: intent.expectedArticleSymbol,
      expectedAmountStroops: intent.expectedAmountStroops,
      expectedContractId: intent.expectedContractId,
      expectedMinTime: intent.expectedMinTime,
      expectedMaxTime: intent.expectedMaxTime,
      quotePriceUsd: intent.quotePriceUsd,
      quoteSource: intent.quoteSource,
      quoteFetchedAt: intent.quoteFetchedAt,
      startOffset: intent.startOffset,
      endOffset: intent.endOffset,
      startContainerPath: intent.startContainerPath,
      endContainerPath: intent.endContainerPath,
      status: 'PENDING',
      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.intentId, { tipId, updatedAt: now })
    await ctx.scheduler.runAfter(
      HORIZON_VERIFY_INITIAL_DELAY_MS,
      internal.stellarVerify.verifyHighlightTip,
      { highlightTipId: tipId, attempt: 1 }
    )
    return tipId
  },
})

export const getHighlightTipStatus = query({
  args: { tipId: v.id('highlightTips') },
  returns: v.object({
    status: v.string(),
    failureReason: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.tipperId !== userId || !tip.highlightTipIntentId) {
      throw new Error('Highlight tip not found')
    }
    return {
      status: tip.status,
      failureReason: tip.failureReason,
      verifiedAt: tip.verifiedAt,
    }
  },
})

export const getHighlightTipRecoveryStatus = query({
  args: { tipId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      failureReason: v.optional(v.string()),
      verifiedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const tipId = ctx.db.normalizeId('highlightTips', args.tipId)
    if (!tipId) return null
    const tip = await ctx.db.get(tipId)
    if (!tip || tip.tipperId !== userId || !tip.highlightTipIntentId) {
      return null
    }
    return {
      status: tip.status,
      failureReason: tip.failureReason,
      verifiedAt: tip.verifiedAt,
    }
  },
})

export const retryHighlightTipVerification = mutation({
  args: { tipId: v.id('highlightTips') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const tip = await ctx.db.get(args.tipId)
    if (!tip || tip.tipperId !== userId || !tip.highlightTipIntentId) {
      throw new Error('Highlight tip not found')
    }
    if (tip.status !== 'PENDING') {
      throw new Error('Only pending highlight tips can be retried')
    }

    await ctx.db.patch(args.tipId, {
      failureReason: undefined,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: args.tipId,
      attempt: 1,
    })
    return null
  },
})

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
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    throw new ConvexError(
      'Legacy highlight tip submission is no longer supported. Prepare and submit a highlight tip intent instead.'
    )
  },
})

/**
 * Get public aggregate stats for a specific highlight. Raw tipper and Stellar
 * data stays in the authenticated history queries below.
 */
export const getByHighlight = query({
  args: {
    highlightId: v.string(),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_highlight', (q) => q.eq('highlightId', args.highlightId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalAmountCents = tips.reduce((sum, tip) => sum + tip.amountCents, 0)
    return {
      tipCount: tips.length,
      totalAmountCents,
      totalAmountUsd: totalAmountCents / 100,
    }
  },
})

/**
 * Get aggregate highlight groups for an article heatmap. Only CONFIRMED tips
 * contribute, and raw tipper or Stellar data is never returned publicly.
 */
export const getByArticle = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const tips = await ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const groups = new Map<
      string,
      {
        highlightId: string
        highlightText: string
        startOffset: number
        endOffset: number
        totalAmountCents: number
        tipCount: number
      }
    >()

    for (const tip of tips) {
      const group = groups.get(tip.highlightId)
      if (group) {
        group.totalAmountCents += tip.amountCents
        group.tipCount += 1
      } else {
        groups.set(tip.highlightId, {
          highlightId: tip.highlightId,
          highlightText: tip.highlightText,
          startOffset: tip.startOffset,
          endOffset: tip.endOffset,
          totalAmountCents: tip.amountCents,
          tipCount: 1,
        })
      }
    }

    return [...groups.values()]
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
  args: {},
  handler: async (ctx) => {
    const tipperId = await getAuthUserId(ctx)
    if (!tipperId) return []

    return await ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', tipperId))
      .order('desc')
      .collect()
  },
})

/**
 * Get highlight tips received by author. PENDING/FAILED tips are excluded —
 * mirrors tips.getUserReceivedTips so authors only see verified earnings.
 */
export const getByAuthor = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await getAuthUserId(ctx)
    if (!authorId) return []

    return await ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', authorId))
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
