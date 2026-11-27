import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

// Mirrors contracts/tipping: the platform fee is rounded down and the writer
// keeps the rest of the tip.
const PLATFORM_FEE_BPS = BigInt(250)
const BPS_DENOMINATOR = BigInt(10_000)
const STROOPS_PER_XLM = BigInt(10_000_000)
export const TOP_ARTICLE_LIMIT = 10

export function getMonthKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseStroops(value: string | undefined): bigint | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  return BigInt(value)
}

export function roundCents(cents: number): number {
  return Math.round(cents * 10_000) / 10_000
}

/**
 * The writer's share of a tip, in cents. Uses the exact on-chain stroop split
 * when the tip recorded it; otherwise applies the same 2.5% fee to the cents.
 */
export function writerShareCents(
  amountCents: number,
  amountStroops?: string
): number {
  const stroops = parseStroops(amountStroops)
  if (stroops) {
    const fee = (stroops * PLATFORM_FEE_BPS) / BPS_DENOMINATOR
    return roundCents((amountCents * Number(stroops - fee)) / Number(stroops))
  }
  return roundCents(
    (amountCents * Number(BPS_DENOMINATOR - PLATFORM_FEE_BPS)) /
      Number(BPS_DENOMINATOR)
  )
}

/**
 * The XLM writer share of a v1 tip in stroops, from the stroop amount the tip
 * expected (or its recorded XLM amount): the tip less the 2.5% platform fee.
 */
export function writerShareStroops(tip: {
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

/**
 * The writer's share of a settled tab tip in US cents: its recorded cents
 * scaled by net over gross. Tab settlement (`setReceiptStatus`) credits
 * exactly this, and the lifetime totals count it the same way.
 */
export function tabShareCents(
  amountCents: number,
  net: bigint,
  gross: bigint
): number {
  return gross > BigInt(0)
    ? roundCents(
        amountCents * (Number((net * BigInt(1_000_000)) / gross) / 1_000_000)
      )
    : 0
}

/**
 * Fields for a new `authorEarnings` row: its lifetime totals (#552) start
 * complete, since every later credit adds to them, unless the user has v1 tip
 * rows from before the row existed. Those rows wait for the rebuild
 * (`earningsTotalsBackfill.ts`).
 */
export async function newRowTotalsFields(
  ctx: MutationCtx,
  userId: Id<'users'>,
  now: number
): Promise<{ lifetimeTotalsAt?: number }> {
  for (const table of ['tips', 'highlightTips'] as const) {
    const v1 = await ctx.db
      .query(table)
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter((q) => q.neq(q.field('contractVersion'), 'v2'))
      .first()
    if (v1) return {}
  }
  return { lifetimeTotalsAt: now }
}

/** Adds one confirmed tip's writer share to the author's earnings record. */
export async function creditAuthorEarnings(
  ctx: MutationCtx,
  credit: {
    authorId: Id<'users'>
    articleId: Id<'articles'>
    articleTitle: string
    shareCents: number
    now: number
  }
): Promise<void> {
  const { authorId, articleId, articleTitle, shareCents, now } = credit
  const shareUsd = shareCents / 100
  const monthKey = getMonthKey(now)
  const earnings = await ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', authorId))
    .first()

  if (!earnings) {
    await ctx.db.insert('authorEarnings', {
      userId: authorId,
      totalEarnedUsd: shareUsd,
      totalEarnedCents: shareCents,
      availableBalanceUsd: shareUsd,
      availableBalanceCents: shareCents,
      pendingBalanceUsd: 0,
      pendingBalanceCents: 0,
      withdrawnUsd: 0,
      withdrawnCents: 0,
      tipCount: 1,
      lastTipAt: now,
      monthlyEarnings: { [monthKey]: shareUsd },
      topArticles: [
        { articleId, title: articleTitle, earnings: shareUsd, tipCount: 1 },
      ],
      ...(await newRowTotalsFields(ctx, authorId, now)),
      createdAt: now,
      updatedAt: now,
    })
    return
  }

  const monthlyEarnings = {
    ...earnings.monthlyEarnings,
    [monthKey]: (earnings.monthlyEarnings?.[monthKey] || 0) + shareUsd,
  }
  const topArticles = [...(earnings.topArticles || [])]
  const articleIndex = topArticles.findIndex(
    (entry) => entry.articleId === articleId
  )
  if (articleIndex >= 0 && topArticles[articleIndex]) {
    topArticles[articleIndex].earnings += shareUsd
    topArticles[articleIndex].tipCount += 1
  } else {
    topArticles.push({
      articleId,
      title: articleTitle,
      earnings: shareUsd,
      tipCount: 1,
    })
  }
  topArticles.sort((a, b) => b.earnings - a.earnings)
  topArticles.splice(TOP_ARTICLE_LIMIT)

  const totalEarnedCents = roundCents(earnings.totalEarnedCents + shareCents)
  const availableBalanceCents = roundCents(
    earnings.availableBalanceCents + shareCents
  )
  await ctx.db.patch(earnings._id, {
    totalEarnedCents,
    totalEarnedUsd: totalEarnedCents / 100,
    availableBalanceCents,
    availableBalanceUsd: availableBalanceCents / 100,
    tipCount: earnings.tipCount + 1,
    lastTipAt: now,
    monthlyEarnings,
    topArticles,
    updatedAt: now,
  })
}
