import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import {
  getMonthKey,
  roundCents,
  TOP_ARTICLE_LIMIT,
  writerShareCents,
} from './lib/authorEarnings'

// One-time correction for earnings rows that were credited with the full tip
// instead of the writer's share. Each row is rebuilt from the author's
// CONFIRMED article and highlight tips, so running it again is a no-op.
// Tips flagged with an untrusted USD amount stay out of earnings.
//
// Tip histories are read in pages and each row is written once, only if it
// has not changed since the read started; a changed row is read again.
//
// Dry run (no writes):
//   bunx convex run authorEarningsBackfill:run '{"dryRun": true}'
// Apply:
//   bunx convex run authorEarningsBackfill:run '{"dryRun": false}'

const EARNINGS_PAGE_SIZE = 50
const TIP_PAGE_SIZE = 200
const MAX_ATTEMPTS_PER_ROW = 3

const confirmedTipValidator = v.object({
  articleId: v.id('articles'),
  articleTitle: v.string(),
  amountCents: v.number(),
  expectedAmountStroops: v.optional(v.string()),
  confirmedAt: v.number(),
})

const rebuiltValidator = v.object({
  totalEarnedCents: v.number(),
  totalEarnedUsd: v.number(),
  availableBalanceCents: v.number(),
  availableBalanceUsd: v.number(),
  tipCount: v.number(),
  lastTipAt: v.optional(v.number()),
  monthlyEarnings: v.record(v.string(), v.number()),
  topArticles: v.array(
    v.object({
      articleId: v.id('articles'),
      title: v.string(),
      earnings: v.number(),
      tipCount: v.number(),
    })
  ),
})

type ConfirmedTip = {
  articleId: Id<'articles'>
  articleTitle: string
  amountCents: number
  expectedAmountStroops?: string
  confirmedAt: number
}

function toConfirmedTip(
  tip: Doc<'tips'> | Doc<'highlightTips'>
): ConfirmedTip | null {
  if (tip.status !== 'CONFIRMED') return null
  if ('amountUsdSuspicious' in tip && tip.amountUsdSuspicious) return null
  return {
    articleId: tip.articleId,
    articleTitle: tip.articleTitle,
    amountCents: tip.amountCents,
    expectedAmountStroops: tip.expectedAmountStroops,
    confirmedAt: tip.verifiedAt ?? tip.processedAt ?? tip.createdAt,
  }
}

export const listEarningsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('authorEarnings')
      .paginate({ cursor, numItems: EARNINGS_PAGE_SIZE })
    return {
      ids: page.page.map((row) => row._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

export const getEarnings = internalQuery({
  args: { id: v.id('authorEarnings') },
  handler: (ctx, { id }) => ctx.db.get(id),
})

export const confirmedTipsPage = internalQuery({
  args: {
    authorId: v.id('users'),
    table: v.union(v.literal('tips'), v.literal('highlightTips')),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    tips: v.array(confirmedTipValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { authorId, table, cursor }) => {
    const page =
      table === 'tips'
        ? await ctx.db
            .query('tips')
            .withIndex('by_author', (q) => q.eq('authorId', authorId))
            .paginate({ cursor, numItems: TIP_PAGE_SIZE })
        : await ctx.db
            .query('highlightTips')
            .withIndex('by_author', (q) => q.eq('authorId', authorId))
            .paginate({ cursor, numItems: TIP_PAGE_SIZE })
    const tips: ConfirmedTip[] = []
    for (const row of page.page) {
      const tip = toConfirmedTip(row)
      if (tip) tips.push(tip)
    }
    return { tips, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})

export const applyRebuild = internalMutation({
  args: {
    id: v.id('authorEarnings'),
    expectedUpdatedAt: v.number(),
    values: rebuiltValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { id, expectedUpdatedAt, values }) => {
    const earnings = await ctx.db.get(id)
    if (!earnings || earnings.updatedAt !== expectedUpdatedAt) return false
    await ctx.db.patch(id, {
      ...values,
      lastTipAt: values.lastTipAt ?? earnings.lastTipAt,
      updatedAt: Date.now(),
    })
    return true
  },
})

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
      articleId: Id<'articles'>
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
    lastTipAt,
    monthlyEarnings,
    topArticles: [...byArticle.values()]
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, TOP_ARTICLE_LIMIT),
  }
}

export const run = internalAction({
  args: { dryRun: v.boolean() },
  returns: v.object({
    dryRun: v.boolean(),
    rows: v.number(),
    changedRows: v.number(),
    skippedRows: v.number(),
    beforeTotalUsd: v.number(),
    afterTotalUsd: v.number(),
  }),
  handler: async (ctx, { dryRun }) => {
    let rows = 0
    let changedRows = 0
    let skippedRows = 0
    let beforeTotalCents = 0
    let afterTotalCents = 0
    let cursor: string | null = null

    for (;;) {
      const page: {
        ids: Id<'authorEarnings'>[]
        isDone: boolean
        continueCursor: string
      } = await ctx.runQuery(internal.authorEarningsBackfill.listEarningsPage, {
        cursor,
      })

      for (const id of page.ids) {
        rows += 1
        let settled = false
        for (
          let attempt = 0;
          attempt < MAX_ATTEMPTS_PER_ROW && !settled;
          attempt++
        ) {
          const earnings: Doc<'authorEarnings'> | null = await ctx.runQuery(
            internal.authorEarningsBackfill.getEarnings,
            { id }
          )
          if (!earnings) {
            settled = true
            break
          }

          const tips: ConfirmedTip[] = []
          for (const table of ['tips', 'highlightTips'] as const) {
            let tipCursor: string | null = null
            for (;;) {
              const tipPage: {
                tips: ConfirmedTip[]
                isDone: boolean
                continueCursor: string
              } = await ctx.runQuery(
                internal.authorEarningsBackfill.confirmedTipsPage,
                { authorId: earnings.userId, table, cursor: tipCursor }
              )
              tips.push(...tipPage.tips)
              if (tipPage.isDone) break
              tipCursor = tipPage.continueCursor
            }
          }

          const rebuilt = rebuildEarnings(earnings, tips)
          const changed =
            rebuilt.totalEarnedCents !== earnings.totalEarnedCents ||
            rebuilt.availableBalanceCents !== earnings.availableBalanceCents ||
            rebuilt.tipCount !== earnings.tipCount
          if (changed && !dryRun) {
            const applied: boolean = await ctx.runMutation(
              internal.authorEarningsBackfill.applyRebuild,
              { id, expectedUpdatedAt: earnings.updatedAt, values: rebuilt }
            )
            if (!applied) continue
          }
          beforeTotalCents = roundCents(
            beforeTotalCents + earnings.totalEarnedCents
          )
          afterTotalCents = roundCents(
            afterTotalCents + rebuilt.totalEarnedCents
          )
          if (changed) changedRows += 1
          settled = true
        }
        if (!settled) skippedRows += 1
      }

      if (page.isDone) break
      cursor = page.continueCursor
    }

    return {
      dryRun,
      rows,
      changedRows,
      skippedRows,
      beforeTotalUsd: beforeTotalCents / 100,
      afterTotalUsd: afterTotalCents / 100,
    }
  },
})
