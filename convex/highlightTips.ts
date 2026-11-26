import { getTipArticleSummary } from './lib/tipArticleSummary'
import { mutation, query } from './_generated/server'
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
import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { StrKey } from '@stellar/stellar-sdk'
import { internal } from './_generated/api'
import {
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  TIP_MIN_STROOPS,
  HORIZON_VERIFY_INITIAL_DELAY_MS,
  HIGHLIGHT_TIP_VERIFY_FALLBACK_DELAY_MS,
  HIGHLIGHT_TIP_VERIFY_REQUEST_COOLDOWN_MS,
  TIP_HIGHLIGHT_DIRECT_FUNCTION,
  getStellarNetwork,
  getTippingContractId,
} from './lib/constants'
import { enforceTipCooldown } from './lib/rateLimit'
import {
  ARTICLE_TIP_FALLBACK_XLM_USD_RATE,
  ARTICLE_TIP_INTENT_TTL_MS,
  articleTipIntentTimeBoundsServer,
  quoteTipAmount,
  tipXlmPresetValidator,
  validateTipAmount,
  shortArticleIdServer,
} from './lib/articleTipExpectation'
import { generateHighlightIdServer } from './lib/highlightHash'
import { resolveCanonicalHighlightPassage } from './lib/tiptapContent'
import { MAX_PRICE_AGE_MS } from './xlmPrice'
import {
  normalizeStellarTransactionHash,
  stellarTransactionHashLookupValues,
} from './lib/stellarTransactionHash'
import { xlmStringToStroops } from './stellarVerify'

const MAX_OUTSTANDING_HIGHLIGHT_TIP_INTENTS = 5
const MAX_HIGHLIGHT_CONTAINER_PATH_LENGTH = 256

function stroopsToXlm(stroops: string): string {
  const padded = stroops.padStart(8, '0')
  const whole = padded.slice(0, -7)
  const fraction = padded.slice(-7).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function isValidHighlightContainerPath(path: string | undefined): boolean {
  return (
    path === undefined ||
    (path.length <= MAX_HIGHLIGHT_CONTAINER_PATH_LENGTH &&
      /^text\.\d+$/.test(path))
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
    amountCents: v.optional(v.number()),
    amountXlm: v.optional(tipXlmPresetValidator),
    message: v.optional(v.string()),
    stellarSourceAccount: v.string(),
  },
  returns: v.object({
    intentId: v.id('highlightTipIntents'),
    highlightId: v.string(),
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
    if (!article || !article.published) throw new Error('Article not found')

    const canonicalPassage = resolveCanonicalHighlightPassage(
      article.content,
      args
    )

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
      canonicalPassage.highlightText,
      canonicalPassage.startOffset,
      canonicalPassage.endOffset
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
        intent.highlightText === canonicalPassage.highlightText &&
        intent.startOffset === canonicalPassage.startOffset &&
        intent.endOffset === canonicalPassage.endOffset &&
        intent.startContainerPath === canonicalPassage.startContainerPath &&
        intent.endContainerPath === canonicalPassage.endContainerPath &&
        intent.amountXlm === amountXlm &&
        (amountXlm !== undefined || intent.amountCents === usdCents) &&
        intent.message === args.message &&
        intent.expectedSourceAccount === args.stellarSourceAccount &&
        intent.expectedDestinationAccount === author.stellarAddress &&
        intent.expectedHighlightId === expectedHighlightId &&
        intent.expectedArticleSymbol === expectedArticleSymbol &&
        intent.expectedFunction === TIP_HIGHLIGHT_DIRECT_FUNCTION &&
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
        amountCents: reusable.amountCents,
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
    const { amountCents, expectedAmountStroops } = quoteTipAmount(
      amount,
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
      highlightText: canonicalPassage.highlightText,
      startOffset: canonicalPassage.startOffset,
      endOffset: canonicalPassage.endOffset,
      startContainerPath: canonicalPassage.startContainerPath,
      endContainerPath: canonicalPassage.endContainerPath,
      amountUsd: amountCents / 100,
      amountCents,
      amountXlm,
      message: args.message,
      expectedSourceAccount: args.stellarSourceAccount,
      expectedDestinationAccount: author.stellarAddress,
      expectedHighlightId,
      expectedArticleSymbol,
      expectedAmountStroops: expectedAmountStroops.toString(),
      expectedContractId,
      expectedFunction: TIP_HIGHLIGHT_DIRECT_FUNCTION,
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
      amountCents,
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
        normalizeStellarTransactionHash(existingForIntent.stellarTxId ?? '') ===
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
      expectedFunction: intent.expectedFunction,
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
      verificationGeneration: 0,
      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(args.intentId, { tipId, updatedAt: now })
    await ctx.scheduler.runAfter(
      HIGHLIGHT_TIP_VERIFY_FALLBACK_DELAY_MS,
      internal.stellarVerify.verifyHighlightTip,
      { highlightTipId: tipId, attempt: 1, generation: 0 }
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

    const now = Date.now()
    if (
      tip.verificationRequestedAt !== undefined &&
      now - tip.verificationRequestedAt <
        HIGHLIGHT_TIP_VERIFY_REQUEST_COOLDOWN_MS
    ) {
      return null
    }
    const generation = (tip.verificationGeneration ?? 0) + 1
    await ctx.db.patch(args.tipId, {
      verificationGeneration: generation,
      verificationRequestedAt: now,
      failureReason: undefined,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: args.tipId,
      attempt: 1,
      generation,
    })
    return null
  },
})

/**
 * Compatibility registration for clients that broadcast before the
 * server-owned intent flow was deployed. Reconstructs canonical article,
 * passage, author, network, contract, and accounting data server-side. Client
 * transaction facts remain untrusted claims until Horizon proves the exact
 * on-chain payment.
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

    const stellarTxId = normalizeStellarTransactionHash(args.stellarTxId)
    if (!stellarTxId) throw new Error('Invalid Stellar transaction hash')
    if (
      !args.stellarSourceAccount ||
      !StrKey.isValidEd25519PublicKey(args.stellarSourceAccount)
    ) {
      throw new Error('Invalid Stellar source account')
    }
    const paidStroops = args.stellarAmountXlm
      ? xlmStringToStroops(args.stellarAmountXlm)
      : null
    if (
      paidStroops === null ||
      paidStroops < BigInt(TIP_MIN_STROOPS) ||
      paidStroops > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error('Invalid Stellar amount')
    }
    if (
      !Number.isSafeInteger(args.amountCents) ||
      args.amountCents < TIP_MIN_CENTS ||
      args.amountCents > TIP_MAX_CENTS
    ) {
      throw new Error('Invalid tip amount')
    }
    if (
      !args.highlightText.trim() ||
      args.highlightText.length > 5000 ||
      !Number.isSafeInteger(args.startOffset) ||
      !Number.isSafeInteger(args.endOffset) ||
      args.startOffset < 0 ||
      args.endOffset <= args.startOffset ||
      !isValidHighlightContainerPath(args.startContainerPath) ||
      !isValidHighlightContainerPath(args.endContainerPath)
    ) {
      throw new Error('Invalid highlight selection')
    }

    const [tipper, article] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(args.articleId),
    ])
    if (!tipper) throw new Error('User not found')
    if (!article || !article.published) throw new Error('Article not found')
    const canonicalPassage = resolveCanonicalHighlightPassage(
      article.content,
      args
    )
    const author = await ctx.db.get(article.authorId)
    if (
      !author?.stellarAddress ||
      typeof author.stellarAddress !== 'string' ||
      !StrKey.isValidEd25519PublicKey(author.stellarAddress)
    ) {
      throw new Error('Author has not configured a valid receiving wallet')
    }

    const expectedHighlightId = await generateHighlightIdServer(
      article.slug,
      canonicalPassage.highlightText,
      canonicalPassage.startOffset,
      canonicalPassage.endOffset
    )
    const expectedArticleSymbol = await shortArticleIdServer(
      args.articleId.toString()
    )
    const expectedNetwork = getStellarNetwork()
    if (
      args.highlightId !== expectedHighlightId ||
      args.stellarMemo !== expectedHighlightId
    ) {
      throw new Error('Highlight receipt does not match the article passage')
    }
    if (
      args.stellarDestinationAccount !== undefined &&
      args.stellarDestinationAccount !== author.stellarAddress
    ) {
      throw new Error('Highlight receipt does not match the article author')
    }
    if (
      args.stellarNetwork !== undefined &&
      args.stellarNetwork !== expectedNetwork
    ) {
      throw new Error('Highlight receipt uses the wrong Stellar network')
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
      const existing = existingForHashes[0]!
      if (
        existingForHashes.length === 1 &&
        existing.tipperId === userId &&
        existing.articleId === args.articleId &&
        existing.highlightId === expectedHighlightId
      ) {
        return existing._id
      }
      throw new ConvexError(
        'This Stellar transaction is already linked to a different tip.'
      )
    }

    await enforceTipCooldown(ctx, userId)
    const now = Date.now()
    const cachedRate = await ctx.db.query('xlmPriceCache').first()
    const useCachedRate =
      cachedRate !== null && now - cachedRate.fetchedAt <= MAX_PRICE_AGE_MS
    const quotePriceUsd = useCachedRate
      ? cachedRate.priceUsd
      : ARTICLE_TIP_FALLBACK_XLM_USD_RATE
    const quoteSource = useCachedRate ? cachedRate.source : 'Fallback'
    const quoteFetchedAt = useCachedRate ? cachedRate.fetchedAt : now
    const amountCents = Math.max(
      TIP_MIN_CENTS,
      Math.floor((Number(paidStroops) * quotePriceUsd * 100) / 10_000_000)
    )
    if (amountCents > TIP_MAX_CENTS) {
      throw new Error('Paid Stellar amount is outside the supported tip range')
    }
    const expectedContractId = getTippingContractId()
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
      highlightText: canonicalPassage.highlightText,
      startOffset: canonicalPassage.startOffset,
      endOffset: canonicalPassage.endOffset,
      startContainerPath: canonicalPassage.startContainerPath,
      endContainerPath: canonicalPassage.endContainerPath,
      amountUsd: amountCents / 100,
      amountCents,
      expectedSourceAccount: args.stellarSourceAccount,
      expectedDestinationAccount: author.stellarAddress,
      expectedHighlightId,
      expectedArticleSymbol,
      expectedAmountStroops: paidStroops.toString(),
      expectedContractId,
      expectedFunction: TIP_HIGHLIGHT_DIRECT_FUNCTION,
      expectedMinTime: '',
      expectedMaxTime: '',
      expectedStellarNetwork: expectedNetwork,
      quotePriceUsd,
      quoteSource,
      quoteFetchedAt,
      legacyCompatibility: true,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    const tipId = await ctx.db.insert('highlightTips', {
      highlightId: expectedHighlightId,
      articleId: args.articleId,
      tipperId: userId,
      authorId: article.authorId,
      highlightText: canonicalPassage.highlightText,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: tipper.name || tipper.username,
      tipperAvatar: tipper.avatar,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      amountUsd: amountCents / 100,
      amountCents,
      stellarTxId,
      stellarNetwork: expectedNetwork,
      stellarMemo: expectedHighlightId,
      stellarLedger: args.stellarLedger,
      stellarFeeCharged: args.stellarFeeCharged,
      stellarSourceAccount: args.stellarSourceAccount,
      stellarDestinationAccount: author.stellarAddress,
      stellarAmountXlm: stroopsToXlm(paidStroops.toString()),
      contractTipId: args.contractTipId,
      highlightTipIntentId: intentId,
      expectedSourceAccount: args.stellarSourceAccount,
      expectedDestinationAccount: author.stellarAddress,
      expectedHighlightId,
      expectedArticleSymbol,
      expectedAmountStroops: paidStroops.toString(),
      expectedContractId,
      expectedFunction: TIP_HIGHLIGHT_DIRECT_FUNCTION,
      expectedMinTime: '',
      expectedMaxTime: '',
      quotePriceUsd,
      quoteSource,
      quoteFetchedAt,
      startOffset: canonicalPassage.startOffset,
      endOffset: canonicalPassage.endOffset,
      startContainerPath: canonicalPassage.startContainerPath,
      endContainerPath: canonicalPassage.endContainerPath,
      status: 'PENDING',
      verificationGeneration: 0,
      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(intentId, { tipId, updatedAt: now })
    await ctx.scheduler.runAfter(
      HORIZON_VERIFY_INITIAL_DELAY_MS,
      internal.stellarVerify.verifyHighlightTip,
      { highlightTipId: tipId, attempt: 1, generation: 0 }
    )
    return tipId
  },
})

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
      .filter((tip) => paidToExpectedAuthor(tip, user?.stellarAddress))
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
        .filter((tip) => paidToExpectedAuthor(tip, user?.stellarAddress))
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
