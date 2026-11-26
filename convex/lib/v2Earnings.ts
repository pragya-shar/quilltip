/**
 * `authorEarnings` updates for v2 direct and batch tips
 * (docs/architecture/v2/06-app-integration.md, section 6.2).
 *
 * Rule: when a direct or batch tip becomes `CONFIRMED` or `MISMATCH`,
 * `earned += net` for the on-chain recipient's user, and nothing when the
 * address belongs to no user. `net` is the recorded on-chain `Tipped.net`
 * (`netBaseUnits`), never a client value.
 *
 * - **Co-author splits.** `Tipped.net` covers every recipient. When the
 *   article's registered splits start with the on-chain author, `net` is
 *   divided with the contract's rule (I-2): each later recipient receives
 *   `floor(net × bps / 10,000)` and the first the remainder.
 * - **Idempotency.** A row is handled once; `earningsAppliedAt` marks it.
 * - **Review.** A `MISMATCH` row with `needsReview` (a payment field differs,
 *   or the transaction holds no `Tipped` event) is not credited: its stored
 *   token and gross are the prepared values, not the decoded ones. It is
 *   marked with `earningsSkipReason: 'needs_review'` for a reviewer.
 * - **Recipient.** The row's expected author is credited when their linked
 *   address is the on-chain address. Any other address is credited only when
 *   exactly one user links it, because a linked address is not proof of
 *   ownership.
 * - **Cents.** The display figures use the USD amount stored on the row at
 *   prepare (`amountCents`), in proportion to each recipient's share of gross.
 */
import {
  isStellarAddressVerified,
  verifiedStellarAddress,
  walletNetworkPassphrase,
} from './walletVerification'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { BPS_DENOMINATOR } from './chain/fees'
import { creditAuthorEarnings, roundCents } from './authorEarnings'
import { contractVersionOf } from './tipReads'

export type TipTable = 'tips' | 'highlightTips'
type TipRow = Doc<'tips'> | Doc<'highlightTips'>

export type ApplyResult =
  | 'credited'
  | 'not_applicable'
  | 'already_applied'
  | 'no_amount'
  | 'needs_review'

const BASE_UNITS = /^[0-9]{1,39}$/

function parseBaseUnits(value: string | undefined): bigint | null {
  if (!value || !BASE_UNITS.test(value)) return null
  return BigInt(value)
}

/**
 * `(address, share)` per recipient of `net`. Uses the registered splits only
 * when their first recipient is the on-chain author; otherwise the author
 * receives all of `net`.
 */
export function recipientShares(
  net: bigint,
  onChainAuthor: string,
  splits: Array<{ recipient: string; bps: number }>
): Array<{ address: string; share: bigint }> {
  if (splits.length < 2 || splits[0]?.recipient !== onChainAuthor) {
    return [{ address: onChainAuthor, share: net }]
  }
  const denominator = BigInt(BPS_DENOMINATOR)
  const others = splits.slice(1).map((s) => ({
    address: s.recipient,
    share: (net * BigInt(s.bps)) / denominator,
  }))
  const rest = others.reduce((sum, o) => sum + o.share, BigInt(0))
  return [{ address: onChainAuthor, share: net - rest }, ...others]
}

function addBaseUnits(
  record: Record<string, string> | undefined,
  token: string,
  amount: bigint
): Record<string, string> {
  const current = parseBaseUnits(record?.[token]) ?? BigInt(0)
  return { ...record, [token]: (current + amount).toString() }
}

/** USD cents for `share`, proportional to the row's stored USD amount. */
export function shareCents(row: TipRow, share: bigint): number {
  const gross = parseBaseUnits(row.grossBaseUnits)
  if (!gross || gross <= BigInt(0)) return 0
  // Scale to 1e6 parts to keep precision before converting to a number.
  const parts = Number((share * BigInt(1_000_000)) / gross) / 1_000_000
  return roundCents(row.amountCents * parts)
}

/**
 * The user to credit for `address`: the row's expected author when they
 * verified that address, otherwise the only user that verified it. Unverified
 * links credit nobody; earnings already credited are not changed.
 */
async function userForAddress(
  ctx: MutationCtx,
  row: TipRow,
  address: string
): Promise<Doc<'users'> | null> {
  const network = walletNetworkPassphrase()
  const expected = await ctx.db.get(row.authorId)
  if (verifiedStellarAddress(expected, network) === address) return expected
  const matches = (
    await ctx.db
      .query('users')
      .withIndex('by_stellar_address', (q) => q.eq('stellarAddress', address))
      .take(50)
  ).filter((user) => isStellarAddressVerified(user, network))
  return matches.length === 1 ? matches[0]! : null
}

async function articleTitle(ctx: MutationCtx, row: TipRow): Promise<string> {
  if ('articleTitle' in row && typeof row.articleTitle === 'string') {
    return row.articleTitle
  }
  const article = await ctx.db.get(row.articleId)
  return article?.title ?? ''
}

async function creditUser(
  ctx: MutationCtx,
  credit: {
    userId: Id<'users'>
    row: TipRow
    title: string
    token: string
    share: bigint
    now: number
  }
): Promise<void> {
  const cents = shareCents(credit.row, credit.share)
  await creditAuthorEarnings(ctx, {
    authorId: credit.userId,
    articleId: credit.row.articleId,
    articleTitle: credit.title,
    shareCents: cents,
    now: credit.now,
  })
  const earnings = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', credit.userId))
    .first()
  if (!earnings) return
  await ctx.db.patch(earnings._id, {
    earnedBaseUnits: addBaseUnits(
      earnings.earnedBaseUnits,
      credit.token,
      credit.share
    ),
    v2TipCount: (earnings.v2TipCount ?? 0) + 1,
    v2EarnedCents: roundCents((earnings.v2EarnedCents ?? 0) + cents),
  })
}

/**
 * Credits one v2 row's net to its on-chain recipients, once. Safe to call
 * from any code path that just made a row `CONFIRMED` or `MISMATCH`, and from
 * the periodic sync.
 */
export async function applyV2TipEarnings(
  ctx: MutationCtx,
  table: TipTable,
  rowId: Id<'tips'> | Id<'highlightTips'>,
  now: number
): Promise<ApplyResult> {
  const row = (await ctx.db.get(rowId)) as TipRow | null
  if (
    !row ||
    contractVersionOf(row) !== 'v2' ||
    (row.status !== 'CONFIRMED' && row.status !== 'MISMATCH')
  ) {
    return 'not_applicable'
  }
  if (row.earningsAppliedAt !== undefined) return 'already_applied'

  const mark = async (skipReason?: string) => {
    const patch = {
      earningsAppliedAt: now,
      ...(skipReason ? { earningsSkipReason: skipReason } : {}),
    }
    if (table === 'tips') {
      await ctx.db.patch(row._id as Id<'tips'>, patch)
    } else {
      await ctx.db.patch(row._id as Id<'highlightTips'>, patch)
    }
  }

  if (typeof row.verifiedAt !== 'number' || row.verifiedAt <= 0) {
    // The chain layer sets the status and verifiedAt together; a paid status
    // without it is left for review instead of blocking the sync.
    await mark('unverified')
    return 'needs_review'
  }
  if (row.needsReview) {
    await mark('needs_review')
    return 'needs_review'
  }

  const net = parseBaseUnits(row.netBaseUnits)
  const token = row.tokenContractId
  const author = row.onChainAuthorAddress
  if (net === null || net <= BigInt(0) || !token || !author) {
    await mark('no_amount')
    return 'no_amount'
  }

  const chainArticle = row.chainArticleKey
    ? await ctx.db
        .query('chainArticles')
        .withIndex('by_article_key', (q) =>
          q.eq('articleKey', row.chainArticleKey!)
        )
        .first()
    : null
  const shares = recipientShares(net, author, chainArticle?.splits ?? [])
  const title = await articleTitle(ctx, row)
  for (const { address, share } of shares) {
    if (share <= BigInt(0)) continue
    const user = await userForAddress(ctx, row, address)
    if (!user) continue
    await creditUser(ctx, { userId: user._id, row, title, token, share, now })
  }
  await mark()
  return 'credited'
}

/** Rows read per (table, status) in one sync run. */
export const SYNC_BATCH = 50

const SYNC_SOURCES: Array<{
  table: TipTable
  paidStatus: 'CONFIRMED' | 'MISMATCH'
}> = [
  { table: 'tips', paidStatus: 'CONFIRMED' },
  { table: 'tips', paidStatus: 'MISMATCH' },
  { table: 'highlightTips', paidStatus: 'CONFIRMED' },
  { table: 'highlightTips', paidStatus: 'MISMATCH' },
]

/**
 * One bounded pass over v2 paid rows that the sync has not handled yet,
 * through the `by_version_status_earnings` index. Handling a row sets
 * `earningsAppliedAt`, which moves it out of the index range, so the next
 * pass starts where this one stopped. No cursor is kept, so a row confirmed
 * late or out of order is still found. Returns true when a source may have
 * more rows.
 */
export async function syncV2TipEarningsBatch(
  ctx: MutationCtx,
  now: number
): Promise<{ credited: number; more: boolean }> {
  let credited = 0
  let more = false
  for (const source of SYNC_SOURCES) {
    const rows = await ctx.db
      .query(source.table)
      .withIndex('by_version_status_earnings', (q) =>
        q
          .eq('contractVersion', 'v2')
          .eq('status', source.paidStatus)
          .eq('earningsAppliedAt', undefined)
      )
      .take(SYNC_BATCH)
    for (const row of rows) {
      const result = await applyV2TipEarnings(ctx, source.table, row._id, now)
      if (result === 'credited') credited += 1
    }
    if (rows.length === SYNC_BATCH) more = true
  }
  return { credited, more }
}
