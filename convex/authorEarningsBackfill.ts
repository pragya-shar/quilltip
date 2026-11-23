import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { internalAction, internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import {
  getMonthKey,
  roundCents,
  TOP_ARTICLE_LIMIT,
  writerShareCents,
} from './lib/authorEarnings'

// One-time correction for earnings rows that were credited with the full tip
// instead of the writer's share. Each row is rebuilt from the author's
// CONFIRMED article and highlight tips, so running it again is a no-op.
//
// Dry run (no writes):
//   bunx convex run authorEarningsBackfill:run '{"dryRun": true}'
// Apply:
//   bunx convex run authorEarningsBackfill:run '{"dryRun": false}'

const BATCH_SIZE = 25

type ConfirmedTip = Pick<
  Doc<'tips'>,
  'articleId' | 'articleTitle' | 'amountCents' | 'expectedAmountStroops'
> & { confirmedAt: number }

async function confirmedTipsForAuthor(
  ctx: MutationCtx,
  authorId: Doc<'users'>['_id']
): Promise<ConfirmedTip[]> {
  const [articleTips, highlightTips] = await Promise.all([
    ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', authorId))
      .collect(),
    ctx.db
      .query('highlightTips')
      .withIndex('by_author', (q) => q.eq('authorId', authorId))
      .collect(),
  ])
  return [...articleTips, ...highlightTips]
    .filter((tip) => tip.status === 'CONFIRMED')
    .map((tip) => ({
      articleId: tip.articleId,
      articleTitle: tip.articleTitle,
      amountCents: tip.amountCents,
      expectedAmountStroops: tip.expectedAmountStroops,
      confirmedAt: tip.verifiedAt ?? tip.processedAt ?? tip.createdAt,
    }))
}

function rebuildEarnings(
  earnings: Doc<'authorEarnings'>,
  tips: ConfirmedTip[]
) {
  let totalEarnedCents = 0
  let lastTipAt: number | undefined
  const monthlyEarnings: Record<string, number> = {}
  const byArticle = new Map<
    string,
    {
      articleId: ConfirmedTip['articleId']
      title: string
      earnings: number
      tipCount: number
    }
  >()

  for (const tip of tips) {
    const shareCents = writerShareCents(
      tip.amountCents,
      tip.expectedAmountStroops
    )
    const shareUsd = shareCents / 100
    totalEarnedCents = roundCents(totalEarnedCents + shareCents)
    lastTipAt = Math.max(lastTipAt ?? 0, tip.confirmedAt)
    const monthKey = getMonthKey(tip.confirmedAt)
    monthlyEarnings[monthKey] = (monthlyEarnings[monthKey] || 0) + shareUsd
    const entry = byArticle.get(tip.articleId) ?? {
      articleId: tip.articleId,
      title: tip.articleTitle,
      earnings: 0,
      tipCount: 0,
    }
    entry.earnings += shareUsd
    entry.tipCount += 1
    byArticle.set(tip.articleId, entry)
  }

  const topArticles = [...byArticle.values()]
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, TOP_ARTICLE_LIMIT)
  // Pending and withdrawn amounts are historical records and stay as they are.
  const availableBalanceCents = Math.max(
    0,
    roundCents(
      totalEarnedCents - earnings.pendingBalanceCents - earnings.withdrawnCents
    )
  )

  return {
    totalEarnedCents,
    totalEarnedUsd: totalEarnedCents / 100,
    availableBalanceCents,
    availableBalanceUsd: availableBalanceCents / 100,
    tipCount: tips.length,
    lastTipAt: lastTipAt ?? earnings.lastTipAt,
    monthlyEarnings,
    topArticles,
  }
}

export const rebuildBatch = internalMutation({
  args: {
    dryRun: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    isDone: v.boolean(),
    continueCursor: v.string(),
    rows: v.number(),
    changedRows: v.number(),
    beforeTotalCents: v.number(),
    afterTotalCents: v.number(),
  }),
  handler: async (ctx, { dryRun, cursor }) => {
    const page = await ctx.db
      .query('authorEarnings')
      .paginate({ cursor, numItems: BATCH_SIZE })

    let changedRows = 0
    let beforeTotalCents = 0
    let afterTotalCents = 0
    for (const earnings of page.page) {
      const tips = await confirmedTipsForAuthor(ctx, earnings.userId)
      const rebuilt = rebuildEarnings(earnings, tips)
      beforeTotalCents = roundCents(
        beforeTotalCents + earnings.totalEarnedCents
      )
      afterTotalCents = roundCents(afterTotalCents + rebuilt.totalEarnedCents)
      const changed =
        rebuilt.totalEarnedCents !== earnings.totalEarnedCents ||
        rebuilt.availableBalanceCents !== earnings.availableBalanceCents ||
        rebuilt.tipCount !== earnings.tipCount
      if (!changed) continue
      changedRows += 1
      if (!dryRun) {
        await ctx.db.patch(earnings._id, { ...rebuilt, updatedAt: Date.now() })
      }
    }

    return {
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      rows: page.page.length,
      changedRows,
      beforeTotalCents,
      afterTotalCents,
    }
  },
})

export const run = internalAction({
  args: { dryRun: v.boolean() },
  returns: v.object({
    dryRun: v.boolean(),
    rows: v.number(),
    changedRows: v.number(),
    beforeTotalUsd: v.number(),
    afterTotalUsd: v.number(),
  }),
  handler: async (ctx, { dryRun }) => {
    let cursor: string | null = null
    let rows = 0
    let changedRows = 0
    let beforeTotalCents = 0
    let afterTotalCents = 0
    for (;;) {
      const batch: {
        isDone: boolean
        continueCursor: string
        rows: number
        changedRows: number
        beforeTotalCents: number
        afterTotalCents: number
      } = await ctx.runMutation(internal.authorEarningsBackfill.rebuildBatch, {
        dryRun,
        cursor,
      })
      rows += batch.rows
      changedRows += batch.changedRows
      beforeTotalCents = roundCents(beforeTotalCents + batch.beforeTotalCents)
      afterTotalCents = roundCents(afterTotalCents + batch.afterTotalCents)
      if (batch.isDone) break
      cursor = batch.continueCursor
    }
    return {
      dryRun,
      rows,
      changedRows,
      beforeTotalUsd: beforeTotalCents / 100,
      afterTotalUsd: afterTotalCents / 100,
    }
  },
})
