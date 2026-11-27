import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

// Mirrors contracts/tipping: the platform fee is rounded down and the writer
// keeps the rest of the tip.
const PLATFORM_FEE_BPS = BigInt(250)
const BPS_DENOMINATOR = BigInt(10_000)
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
 * The writer's share of a tab tip's cents: the tip's cents times the net
 * share of its base units, on the 1/10,000-cent grid of `roundCents`. The
 * same rule as `tabShareCents` in the lifetime totals change (#552).
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
