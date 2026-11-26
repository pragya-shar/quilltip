/**
 * Payments v2 direct, highlight and batch tips
 * (docs/architecture/v2/05-flows-and-admin.md, sections 5.2 to 5.4;
 * 06-app-integration.md, sections 6.1 and 6.3).
 *
 * Flow for the client:
 * 1. `prepareDirectTip`, `prepareHighlightTip` or `prepareBatch` with a new
 *    `requestId`. The result holds everything needed to build `Core.tip`
 *    (one item) or `Core.tip_batch` (several) with time bounds `[0, maxTime]`.
 * 2. After `sendTransaction` returns `PENDING` or `DUPLICATE`:
 *    `recordSubmitted`. After a failed simulation, a wallet refusal or a send
 *    `ERROR`: `recordSendFailed`.
 * 3. Watch `getTipStatus` until `uiState` is final. Only the server verifier
 *    or the indexer confirms a tip (I-21). Offer "Try again" only when
 *    `canRetry` is true, with a new `requestId`.
 *
 * Errors are `ConvexError` data `{ code, message, ... }`; the codes are
 * `TIP_V2_ERROR_CODES` in `convex/lib/chain/tipPrepare.ts`.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import {
  MAX_BATCH_ITEMS,
  MAX_BATCH_TRANSFERS,
  assertNotSelfTip,
  cachedCoreConfig,
  freshPrice,
  isTipSubmission,
  minimumCents,
  prepareTips,
  recipientCount,
  requireCoreOpen,
  requireTipChain,
  requireTipperAddress,
  requireTippableArticle,
  tipError,
  tipStatusFor,
  transferCount,
  type PreparedTip,
  type TipStatus,
  type TipV2ErrorCode,
  type TipV2ErrorData,
} from './lib/chain/tipPrepare'

export type {
  PreparedTip,
  PreparedTipItem,
  TipQuote,
  TipStatus,
  TipItemStatus,
  TipUiState,
  TipV2ErrorCode,
  TipV2ErrorData,
} from './lib/chain/tipPrepare'
export { TIP_V2_ERROR_CODES } from './lib/chain/tipPrepare'

const highlightValidator = v.object({
  text: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  startContainerPath: v.optional(v.string()),
  endContainerPath: v.optional(v.string()),
})

const tipIdValidator = v.union(v.id('tips'), v.id('highlightTips'))

async function requireUserId(ctx: QueryCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) tipError('UNAUTHENTICATED', 'Sign in first.')
  return userId
}

/** Direct article tip (5.2): one `Core.tip` with no highlight. */
export const prepareDirectTip = mutation({
  args: {
    requestId: v.string(),
    articleId: v.id('articles'),
    amountCents: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PreparedTip> => {
    const userId = await requireUserId(ctx)
    return prepareTips(ctx, {
      userId,
      requestId: args.requestId,
      mode: 'direct',
      items: [
        {
          articleId: args.articleId,
          amountCents: args.amountCents,
          message: args.message,
        },
      ],
      now: Date.now(),
    })
  },
})

/** Highlight tip (5.3): one `Core.tip` carrying `highlight_id`. */
export const prepareHighlightTip = mutation({
  args: {
    requestId: v.string(),
    articleId: v.id('articles'),
    amountCents: v.number(),
    highlight: highlightValidator,
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PreparedTip> => {
    const userId = await requireUserId(ctx)
    return prepareTips(ctx, {
      userId,
      requestId: args.requestId,
      mode: 'highlight',
      items: [
        {
          articleId: args.articleId,
          amountCents: args.amountCents,
          highlight: args.highlight,
          message: args.message,
        },
      ],
      now: Date.now(),
    })
  },
})

/**
 * Batch tip (5.4): 1 to 10 items, at most 24 transfers. With one item the
 * result's `method` is `tip`; with more it is `tip_batch`.
 */
export const prepareBatch = mutation({
  args: {
    requestId: v.string(),
    items: v.array(
      v.object({
        articleId: v.id('articles'),
        amountCents: v.number(),
        highlight: v.optional(v.union(highlightValidator, v.null())),
        message: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<PreparedTip> => {
    const userId = await requireUserId(ctx)
    return prepareTips(ctx, {
      userId,
      requestId: args.requestId,
      mode: 'batch',
      items: args.items,
      now: Date.now(),
    })
  },
})

/** The caller's tip submission, from a submission ID or one of its tip IDs. */
async function ownTipSubmission(
  ctx: QueryCtx,
  userId: Id<'users'>,
  ref: { submissionId?: Id<'chainSubmissions'>; tipId?: string }
): Promise<Doc<'chainSubmissions'> | null> {
  let submissionId = ref.submissionId
  if (!submissionId && ref.tipId) {
    const tipsId = ctx.db.normalizeId('tips', ref.tipId)
    const highlightId = ctx.db.normalizeId('highlightTips', ref.tipId)
    const row = tipsId
      ? await ctx.db.get(tipsId)
      : highlightId
        ? await ctx.db.get(highlightId)
        : null
    submissionId = row?.submissionId
  }
  if (!submissionId) return null
  const submission = await ctx.db.get(submissionId)
  if (!submission || submission.userId !== userId) return null
  return isTipSubmission(submission) ? submission : null
}

async function requireOwnTipSubmission(
  ctx: MutationCtx,
  ref: { submissionId?: Id<'chainSubmissions'>; tipId?: string }
): Promise<Doc<'chainSubmissions'>> {
  const userId = await requireUserId(ctx)
  const submission = await ownTipSubmission(ctx, userId, ref)
  if (!submission) tipError('NOT_FOUND', 'Tip not found.')
  return submission
}

/**
 * Client step 5: `sendTransaction` returned `PENDING` or `DUPLICATE`. Runs
 * `chain.submissions.recordSubmitted`, the one code path for every v2
 * submission: the hash is stored once, a repeat with the same hash is a
 * no-op, and a hash already on another submission is refused, so a
 * `(txHash, clientRef)` pair is accepted once only.
 */
export const recordSubmitted = mutation({
  args: {
    submissionId: v.optional(v.id('chainSubmissions')),
    tipId: v.optional(tipIdValidator),
    txHash: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    submissionId: Id<'chainSubmissions'>
    status: Doc<'chainSubmissions'>['status']
    duplicate: boolean
  }> => {
    const submission = await requireOwnTipSubmission(ctx, args)
    const result = await ctx.runMutation(
      api.chain.submissions.recordSubmitted,
      { submissionId: submission._id, txHash: args.txHash }
    )
    return { submissionId: submission._id, ...result }
  },
})

/**
 * Client step 3 or 5: simulation failed, the wallet refused to sign, or
 * `sendTransaction` returned `ERROR`. Nothing was sent, so only a `PREPARED`
 * record without a hash becomes `FAILED` (retry allowed). Runs
 * `chain.submissions.recordSendFailed`, which stores `reason[: detail]`.
 */
export const recordSendFailed = mutation({
  args: {
    submissionId: v.optional(v.id('chainSubmissions')),
    tipId: v.optional(tipIdValidator),
    reason: v.union(
      v.literal('simulation_failed'),
      v.literal('wallet_rejected'),
      v.literal('send_error')
    ),
    detail: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ submissionId: Id<'chainSubmissions'>; status: 'FAILED' }> => {
    const submission = await requireOwnTipSubmission(ctx, args)
    const result = await ctx.runMutation(
      api.chain.submissions.recordSendFailed,
      {
        submissionId: submission._id,
        reason: args.reason,
        ...(args.detail === undefined ? {} : { detail: args.detail }),
      }
    )
    return { submissionId: submission._id, ...result }
  },
})

/**
 * Status of the caller's tip, by submission ID or by any of its tip IDs.
 * Null when it does not exist or belongs to someone else.
 */
export const getTipStatus = query({
  args: {
    submissionId: v.optional(v.id('chainSubmissions')),
    tipId: v.optional(tipIdValidator),
  },
  handler: async (ctx, args): Promise<TipStatus | null> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const submission = await ownTipSubmission(ctx, userId, args)
    return submission ? tipStatusFor(ctx, submission) : null
  },
})

export type TipEligibility = {
  /** True when a prepare for this article can succeed for the caller. */
  eligible: boolean
  /** The first check that fails, as the prepare call would report it. */
  reason: TipV2ErrorCode | null
  message: string | null
  /** `article_id` hex once the article is registered in this epoch. */
  articleKey: string | null
  authorAddress: string | null
  /** Recipients Core pays; the basket counts `transferCount` against 24. */
  recipientCount: number | null
  transferCount: number | null
  maxBatchItems: number
  maxBatchTransfers: number
  minTipBaseUnits: string | null
  /** Smallest whole cent amount at the current price. */
  minTipCents: number | null
  price: { priceUsd: number; source: string; fetchedAt: number } | null
  tipperAddress: string | null
}

/**
 * Whether the caller can tip an article now, and the limits the tip form
 * needs. Runs the prepare checks without writing; the article checks run
 * before the account checks, so a signed-out reader still learns whether
 * tips are enabled.
 */
export const getTipEligibility = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args): Promise<TipEligibility> => {
    const out: TipEligibility = {
      eligible: false,
      reason: null,
      message: null,
      articleKey: null,
      authorAddress: null,
      recipientCount: null,
      transferCount: null,
      maxBatchItems: MAX_BATCH_ITEMS,
      maxBatchTransfers: MAX_BATCH_TRANSFERS,
      minTipBaseUnits: null,
      minTipCents: null,
      price: null,
      tipperAddress: null,
    }
    try {
      const chain = requireTipChain()
      const config = await cachedCoreConfig(ctx, chain)
      out.minTipBaseUnits = config?.minTip ?? null
      out.price = await freshPrice(ctx, Date.now())
      if (out.price && out.minTipBaseUnits) {
        out.minTipCents = minimumCents(
          BigInt(out.minTipBaseUnits),
          out.price.priceUsd
        )
      }
      const target = await requireTippableArticle(ctx, args.articleId, chain)
      out.articleKey = target.chainArticle.articleKey
      out.authorAddress = target.chainArticle.authorAddress
      out.recipientCount = recipientCount(target.chainArticle.splits)
      out.transferCount = transferCount(target.chainArticle.splits)
      await requireCoreOpen(ctx, chain)
      if (!out.price) {
        tipError(
          'PRICE_UNAVAILABLE',
          'The XLM price is not available right now. Try again shortly.'
        )
      }
      const userId = await requireUserId(ctx)
      const user = await ctx.db.get(userId)
      if (!user) tipError('UNAUTHENTICATED', 'Sign in first.')
      out.tipperAddress = requireTipperAddress(user, chain)
      assertNotSelfTip(target, userId, out.tipperAddress)
      out.eligible = true
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error
      const data = error.data as Partial<TipV2ErrorData>
      out.reason = (data.code as TipV2ErrorCode) ?? null
      out.message = data.message ?? null
    }
    return out
  },
})
