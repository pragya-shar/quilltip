/**
 * Database side of article submissions (register, content update, author
 * change). The submission store and the event indexer call these helpers;
 * they are the only code that moves an article submission to a final state
 * from chain evidence. Client input never confirms one (I-21).
 *
 * `chainArticles` mirrors Core. Indexed events are its source of truth
 * (coreEventHandlers.ts); a verified transaction applies the same change
 * early, guarded so that it never undoes a newer event.
 */
import { v, type Infer } from 'convex/values'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import {
  ARTICLE_EVENT_FOR_KIND,
  isArticleSubmissionKind,
  matchArticleEvent,
  type ArticleEventFacts,
  type ArticleSubmissionKind,
  type ArticleVerification,
} from './articleEvents'

/** States from which chain evidence may resolve a submission. */
const RESOLVABLE: readonly string[] = ['PREPARED', 'SUBMITTED', 'EXPIRED']

const splitValidator = v.object({ recipient: v.string(), bps: v.number() })

export const articleFactsValidator = v.object({
  name: v.string(),
  articleKey: v.string(),
  author: v.optional(v.string()),
  articleRef: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  arweaveId: v.optional(v.union(v.string(), v.null())),
  splits: v.optional(v.array(splitValidator)),
  contentVersion: v.optional(v.number()),
  newAuthor: v.optional(v.string()),
  liveUntilLedger: v.optional(v.number()),
  previous: v.optional(v.string()),
})

export const articleVerificationValidator = v.object({
  status: v.union(v.literal('CONFIRMED'), v.literal('MISMATCH')),
  mismatchReason: v.optional(v.string()),
  needsReview: v.boolean(),
  facts: v.union(articleFactsValidator, v.null()),
})

export type StoredArticleVerification = Infer<
  typeof articleVerificationValidator
>

/** Drops `undefined` fields so the value passes Convex argument validation. */
function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, x]) => x !== undefined)
  ) as T
}

export function storeArticleVerification(
  outcome: ArticleVerification
): StoredArticleVerification {
  return {
    status: outcome.status,
    ...(outcome.status === 'MISMATCH'
      ? { mismatchReason: outcome.mismatchReason }
      : {}),
    needsReview: outcome.needsReview,
    facts: outcome.facts ? clean(outcome.facts) : null,
  }
}

export async function relatedArticle(
  ctx: MutationCtx,
  submission: Doc<'chainSubmissions'>
): Promise<Doc<'chainArticles'> | null> {
  const link = submission.related.find((r) => r.table === 'chainArticles')
  return link ? await ctx.db.get(link.id as Id<'chainArticles'>) : null
}

/**
 * Applies a confirmed article event to `chainArticles` unless the row
 * already reflects the same or a newer state.
 */
async function applyConfirmedFacts(
  ctx: MutationCtx,
  article: Doc<'chainArticles'>,
  kind: ArticleSubmissionKind,
  facts: ArticleEventFacts,
  extra: { txHash: string; ledger: number },
  now: number
): Promise<void> {
  if (kind === 'register') {
    if (article.status === 'REGISTERED') return
    await ctx.db.patch(article._id, {
      status: 'REGISTERED',
      authorAddress: facts.author!,
      contentHash: facts.contentHash!,
      arweaveId: facts.arweaveId ?? undefined,
      contentVersion: 1,
      splits: facts.splits ?? [],
      registeredLedger: extra.ledger,
      txHash: extra.txHash,
      updatedAt: now,
    })
  } else if (kind === 'content_update') {
    if ((facts.contentVersion ?? 0) <= article.contentVersion) return
    await ctx.db.patch(article._id, {
      contentHash: facts.contentHash!,
      arweaveId: facts.arweaveId ?? undefined,
      contentVersion: facts.contentVersion!,
      updatedAt: now,
    })
  } else if (kind === 'author_propose') {
    if (article.authorAddress === facts.newAuthor) return
    await ctx.db.patch(article._id, {
      pendingAuthor: facts.newAuthor,
      pendingAuthorLiveUntil: facts.liveUntilLedger,
      updatedAt: now,
    })
  } else {
    if (article.authorAddress !== facts.previous) return
    await ctx.db.patch(article._id, {
      authorAddress: facts.newAuthor!,
      pendingAuthor: undefined,
      pendingAuthorLiveUntil: undefined,
      // Core moves the first share to the new author.
      splits: article.splits.map((s, i) =>
        i === 0 ? { ...s, recipient: facts.newAuthor! } : s
      ),
      updatedAt: now,
    })
  }
}

/**
 * Rule (a) for article submissions: RPC returned `SUCCESS` for the recorded
 * hash. Idempotent; a final submission is left unchanged.
 */
export async function applyArticleVerification(
  ctx: MutationCtx,
  args: {
    submissionId: Id<'chainSubmissions'>
    txHash: string
    ledger: number
    outcome: StoredArticleVerification
    now: number
  }
): Promise<'applied' | 'skipped'> {
  const submission = await ctx.db.get(args.submissionId)
  if (!submission || submission.txHash !== args.txHash) return 'skipped'
  if (!isArticleSubmissionKind(submission.kind)) return 'skipped'
  if (!RESOLVABLE.includes(submission.status)) return 'skipped'
  await ctx.db.patch(submission._id, {
    status: args.outcome.status,
    mismatchReason: args.outcome.mismatchReason,
    needsReview: args.outcome.needsReview,
    ledger: args.ledger,
    updatedAt: args.now,
  })
  const article = await relatedArticle(ctx, submission)
  if (!article) return 'applied'
  if (args.outcome.status === 'CONFIRMED' && args.outcome.facts) {
    await applyConfirmedFacts(
      ctx,
      article,
      submission.kind,
      args.outcome.facts,
      { txHash: args.txHash, ledger: args.ledger },
      args.now
    )
  } else if (
    submission.kind === 'register' &&
    (article.status === 'SUBMITTED' || article.status === 'PREPARED')
  ) {
    // The transaction succeeded without the expected registration. The row
    // returns to FAILED; the indexer corrects it if Core holds the article.
    await ctx.db.patch(article._id, { status: 'FAILED', updatedAt: args.now })
  }
  return 'applied'
}

/**
 * A register submission failed or expired: no registration happened, so the
 * author may prepare again.
 */
export async function releaseArticleAfterFailure(
  ctx: MutationCtx,
  submission: Doc<'chainSubmissions'>,
  now: number
): Promise<void> {
  if (submission.kind !== 'register') return
  const article = await relatedArticle(ctx, submission)
  if (!article || article.lastSubmissionId !== submission._id) return
  if (article.status === 'PREPARED' || article.status === 'SUBMITTED') {
    await ctx.db.patch(article._id, { status: 'FAILED', updatedAt: now })
  }
}

/**
 * Rule (b) for article submissions: an indexed Core event for the article.
 * Resolves the article's latest submission when the event is the one it
 * expects. Returns what happened, for logging and tests.
 */
export async function resolveArticleSubmissionFromEvent(
  ctx: MutationCtx,
  args: {
    article: Doc<'chainArticles'>
    facts: ArticleEventFacts
    contractId: string
    txHash: string
    ledger: number
    now: number
  }
): Promise<'linked' | 'conflict' | 'none'> {
  const id = args.article.lastSubmissionId
  if (!id) return 'none'
  const submission = await ctx.db.get(id)
  if (
    !submission ||
    !isArticleSubmissionKind(submission.kind) ||
    !submission.expectedArticle ||
    submission.contractId !== args.contractId ||
    ARTICLE_EVENT_FOR_KIND[submission.kind] !== args.facts.name ||
    submission.expectedArticle.articleKey !== args.facts.articleKey
  ) {
    return 'none'
  }
  const outcome = matchArticleEvent(
    submission.kind,
    submission.expectedArticle,
    args.facts
  )
  // A matching event after FAILED, or under another hash, may come from a
  // different transaction: flag it rather than resolve it.
  if (
    outcome.status === 'CONFIRMED' &&
    (submission.status === 'FAILED' ||
      (submission.txHash && submission.txHash !== args.txHash))
  ) {
    if (!submission.needsReview) {
      await ctx.db.patch(submission._id, {
        needsReview: true,
        lastError:
          submission.status === 'FAILED'
            ? 'event_after_failure'
            : 'event_hash_differs',
        updatedAt: args.now,
      })
    }
    return 'conflict'
  }
  if (!RESOLVABLE.includes(submission.status)) return 'none'
  if (outcome.status !== 'CONFIRMED') return 'none'
  if (
    submission.createdLedger !== undefined &&
    args.ledger < submission.createdLedger
  ) {
    return 'none'
  }
  await ctx.db.patch(submission._id, {
    status: 'CONFIRMED',
    needsReview: false,
    txHash: submission.txHash ?? args.txHash,
    ledger: args.ledger,
    updatedAt: args.now,
  })
  return 'linked'
}

/**
 * Rule (b) without an event in hand: the indexer has already brought the
 * article to the state the submission expects. Used by the recheck cron.
 */
export async function resolveArticleSubmissionFromState(
  ctx: MutationCtx,
  submission: Doc<'chainSubmissions'>,
  now: number
): Promise<boolean> {
  if (
    !isArticleSubmissionKind(submission.kind) ||
    !submission.expectedArticle ||
    !RESOLVABLE.includes(submission.status)
  ) {
    return false
  }
  const article = await relatedArticle(ctx, submission)
  const expected = submission.expectedArticle
  if (!article || article.articleKey !== expected.articleKey) return false
  let reached = false
  if (submission.kind === 'register') {
    reached =
      article.status === 'REGISTERED' &&
      article.authorAddress === expected.author &&
      article.contentHash === expected.contentHash
  } else if (submission.kind === 'content_update') {
    reached =
      article.contentVersion >= (expected.contentVersion ?? Infinity) &&
      article.contentHash === expected.contentHash
  } else if (submission.kind === 'author_propose') {
    reached = article.pendingAuthor === expected.newAuthor
  } else {
    reached = article.authorAddress === expected.newAuthor
  }
  if (!reached) return false
  await ctx.db.patch(submission._id, {
    status: 'CONFIRMED',
    needsReview: false,
    ...(article.txHash && !submission.txHash && submission.kind === 'register'
      ? { txHash: article.txHash }
      : {}),
    updatedAt: now,
  })
  return true
}
