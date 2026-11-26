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
 * - **Idempotency.** A row is credited once; `earningsAppliedAt` marks it.
 * - **Cents.** The display figures use the USD amount stored on the row at
 *   prepare (`amountCents`), in proportion to each recipient's share of gross.
 */
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { BPS_DENOMINATOR } from './chain/fees'
import { creditAuthorEarnings, roundCents } from './authorEarnings'
import { contractVersionOf, countsAsPaid } from './tipReads'

export type TipTable = 'tips' | 'highlightTips'
type TipRow = Doc<'tips'> | Doc<'highlightTips'>

export type ApplyResult =
  | 'credited'
  | 'not_applicable'
  | 'already_applied'
  | 'no_amount'

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

async function userByAddress(
  ctx: MutationCtx,
  address: string
): Promise<Doc<'users'> | null> {
  return await ctx.db
    .query('users')
    .withIndex('by_stellar_address', (q) => q.eq('stellarAddress', address))
    .first()
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
  if (!row || contractVersionOf(row) !== 'v2' || !countsAsPaid(row)) {
    return 'not_applicable'
  }
  if (row.earningsAppliedAt !== undefined) return 'already_applied'

  const mark = async () => {
    if (table === 'tips') {
      await ctx.db.patch(row._id as Id<'tips'>, { earningsAppliedAt: now })
    } else {
      await ctx.db.patch(row._id as Id<'highlightTips'>, {
        earningsAppliedAt: now,
      })
    }
  }

  const net = parseBaseUnits(row.netBaseUnits)
  const token = row.tokenContractId
  const author = row.onChainAuthorAddress
  if (net === null || net <= BigInt(0) || !token || !author) {
    // MISMATCH without an event: no on-chain amount to credit.
    await mark()
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
    const user = await userByAddress(ctx, address)
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
 * One bounded pass over newly paid rows, through the `by_status_updated`
 * index from each stored cursor. Returns true when a source may have more
 * rows. Crediting never changes `updatedAt`, so the cursor only moves forward.
 */
export async function syncV2TipEarningsBatch(
  ctx: MutationCtx,
  now: number
): Promise<{ credited: number; more: boolean }> {
  let credited = 0
  let more = false
  for (const source of SYNC_SOURCES) {
    const name = `${source.table}:${source.paidStatus}`
    const cursor = await ctx.db
      .query('earningsSyncCursors')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first()
    const from = cursor?.updatedAt ?? 0
    const rows = await ctx.db
      .query(source.table)
      .withIndex('by_status_updated', (q) =>
        q.eq('status', source.paidStatus).gte('updatedAt', from)
      )
      .take(SYNC_BATCH)
    for (const row of rows) {
      const result = await applyV2TipEarnings(ctx, source.table, row._id, now)
      if (result === 'credited') credited += 1
    }
    const last = rows[rows.length - 1]
    if (!last) continue
    // A full page whose rows all share the cursor value would never advance;
    // step past that millisecond (the rows were credited above).
    const next =
      rows.length === SYNC_BATCH && last.updatedAt === from
        ? from + 1
        : last.updatedAt
    if (rows.length === SYNC_BATCH) more = true
    if (cursor) {
      if (next !== cursor.updatedAt) {
        await ctx.db.patch(cursor._id, { updatedAt: next })
      }
    } else {
      await ctx.db.insert('earningsSyncCursors', { name, updatedAt: next })
    }
  }
  return { credited, more }
}
