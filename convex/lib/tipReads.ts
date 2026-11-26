/**
 * Shared rules for the tip read queries (docs/architecture/v2/06-app-integration.md,
 * sections 6.1 to 6.3).
 *
 * - **Labelling.** Every row is labelled `v1` or `v2` by `contractVersion`. A
 *   row without the field predates payments v2 and is `v1` (the backfill sets
 *   it explicitly).
 * - **Counting.** A v1 row counts once the server verified it (`CONFIRMED`
 *   with `verifiedAt`). A v2 row counts when it is `CONFIRMED`, or `MISMATCH`
 *   without `needsReview`, with `verifiedAt`: both mean the payment reached
 *   the on-chain author, who may differ from the expected one. A `MISMATCH`
 *   with `needsReview` (a payment field differs, or no `Tipped` event) is left
 *   out until it is reviewed, because its stored amounts are not the decoded
 *   on-chain values.
 * - **Amounts.** v2 base-unit amounts are the recorded on-chain values
 *   (`grossBaseUnits`, `feeBaseUnits`, `netBaseUnits` from the `Tipped` event),
 *   never a client value.
 * - **Bounds.** Array queries read at most `LIST_LIMIT` rows; aggregates read
 *   at most `AGGREGATE_LIMIT` rows and report `complete: false` beyond that.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { DatabaseReader } from '../_generated/server'
import { enrichWithUser, type PublicUser } from './enrich'

export type TipRow = Doc<'tips'> | Doc<'highlightTips'>
export type ContractVersion = 'v1' | 'v2'

/** Rows returned by an array query. */
export const LIST_LIMIT = 100
/** Rows read by one aggregate. */
export const AGGREGATE_LIMIT = 2_000
/** Largest page a paginated query returns. */
export const MAX_PAGE_SIZE = 100

/** Statuses read by counting queries, for both versions. */
export const PAID_STATUSES = ['CONFIRMED', 'MISMATCH'] as const

export function contractVersionOf(tip: {
  contractVersion?: ContractVersion
}): ContractVersion {
  return tip.contractVersion ?? 'v1'
}

/** True when the payment of this row happened and was verified by the server. */
export function countsAsPaid(tip: {
  status: string
  verifiedAt?: number
  contractVersion?: ContractVersion
  needsReview?: boolean
}): boolean {
  if (typeof tip.verifiedAt !== 'number' || tip.verifiedAt <= 0) return false
  if (contractVersionOf(tip) === 'v2') {
    if (tip.status === 'CONFIRMED') return true
    return tip.status === 'MISMATCH' && tip.needsReview !== true
  }
  return tip.status === 'CONFIRMED'
}

/**
 * True when the payment of a counted row reached `authorId`. For v2
 * `MISMATCH`, the on-chain author received it, so it is the expected author's
 * only when that author's linked address equals the on-chain address.
 */
export function paidToExpectedAuthor(
  tip: TipRow,
  authorStellarAddress: string | null | undefined
): boolean {
  if (!countsAsPaid(tip)) return false
  if (contractVersionOf(tip) === 'v1' || tip.status === 'CONFIRMED') {
    return true
  }
  return (
    !!authorStellarAddress && tip.onChainAuthorAddress === authorStellarAddress
  )
}

export function clampPageSize(numItems: number): number {
  if (!Number.isFinite(numItems) || numItems < 1) return 1
  return Math.min(Math.floor(numItems), MAX_PAGE_SIZE)
}

/** Base-unit fields of a v2 row; null for v1 rows. */
function chainAmounts(tip: TipRow) {
  if (contractVersionOf(tip) !== 'v2') return null
  return {
    tokenContractId: tip.tokenContractId ?? null,
    grossBaseUnits: tip.grossBaseUnits ?? null,
    feeBaseUnits: tip.feeBaseUnits ?? null,
    netBaseUnits: tip.netBaseUnits ?? null,
    channel: tip.channel ?? null,
  }
}

/**
 * The fields of a tip that any viewer may see. No email, no internal review
 * fields, no expected or quote values.
 */
export function publicTipFields(tip: TipRow) {
  return {
    _id: tip._id,
    articleId: tip.articleId,
    contractVersion: contractVersionOf(tip),
    status: tip.status,
    amountCents: tip.amountCents,
    amountUsd: tip.amountUsd,
    message: tip.message,
    network: tip.stellarNetwork ?? null,
    stellarTxId: tip.stellarTxId ?? null,
    chain: chainAmounts(tip),
    createdAt: tip.createdAt,
  }
}

/** The public fields plus the highlight passage of a highlight tip. */
export function publicHighlightTipFields(tip: Doc<'highlightTips'>) {
  return {
    ...publicTipFields(tip),
    highlightId: tip.highlightId,
    highlightText: tip.highlightText,
    startOffset: tip.startOffset,
    endOffset: tip.endOffset,
  }
}

/**
 * The fields the tipper or the author of a tip may see about their own tip:
 * the public fields plus the verification outcome.
 */
export function ownTipFields(tip: TipRow) {
  return {
    ...publicTipFields(tip),
    failureReason: tip.failureReason,
    mismatchReason: tip.mismatchReason,
    onChainAuthorAddress: tip.onChainAuthorAddress ?? null,
    verifiedAt: tip.verifiedAt,
    updatedAt: tip.updatedAt,
  }
}

export async function withTipper<T extends { tipperId: Id<'users'> }>(
  db: DatabaseReader,
  tip: T
): Promise<PublicUser | null> {
  return await enrichWithUser({ db }, tip.tipperId)
}

/** The registered v2 chain record of an article, if any. */
export async function chainArticleFor(
  db: DatabaseReader,
  articleId: Id<'articles'>
): Promise<Doc<'chainArticles'> | null> {
  return await db
    .query('chainArticles')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .first()
}

/** `chainArticles.totals` of a registered article, empty otherwise. */
export function registeredTotals(
  chainArticle: Doc<'chainArticles'> | null
): Record<string, string> {
  if (!chainArticle || chainArticle.status !== 'REGISTERED') return {}
  return chainArticle.totals
}

/** Number of rows per contract version. */
export function countByVersion(tips: TipRow[]): { v1: number; v2: number } {
  const out = { v1: 0, v2: 0 }
  for (const tip of tips) out[contractVersionOf(tip)] += 1
  return out
}

/**
 * Σ recorded on-chain gross per token over v2 rows, as decimal strings. v1
 * rows have no base-unit record and are left out.
 */
export function sumBaseUnitsByToken(tips: TipRow[]): Record<string, string> {
  const sums = new Map<string, bigint>()
  for (const tip of tips) {
    if (contractVersionOf(tip) !== 'v2') continue
    const token = tip.tokenContractId
    const gross = tip.grossBaseUnits
    if (!token || !gross || !/^[0-9]{1,39}$/.test(gross)) continue
    sums.set(token, (sums.get(token) ?? BigInt(0)) + BigInt(gross))
  }
  return Object.fromEntries(
    [...sums.entries()].map(([token, sum]) => [token, sum.toString()])
  )
}
