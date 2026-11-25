import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { syncReadingRoomEngagement } from './lib/readingRoomIndex'
import {
  CONFIRMED_TIP_STATUS,
  LEGACY_UNVERIFIED_TIP_REASON,
  UNVERIFIED_TIP_STATUS,
  verifiedTipFilter,
} from './lib/verifiedTips'

// Moves CONFIRMED tips that have no verification time to UNVERIFIED, then
// recounts the article and user tip counters they touched from verified tips
// only. Rows stay readable in the tipper's own history.
//
// Dry run is the default and writes nothing. It reports the rows it would
// change and the counter values before and after. Running it again after an
// apply finds no rows, so it is idempotent.
//
// Usage (one page per call; repeat with `cursor` until `isDone` is true, for
// `table: "tips"` and then `table: "highlightTips"`):
//   bunx convex run legacyTipCleanup:run '{"table":"tips"}'
//   bunx convex run legacyTipCleanup:run '{"table":"tips","apply":true}'
// After applying, rebuild earnings from verified tips:
//   bunx convex run authorEarningsBackfill:run '{"dryRun": true}'
//   bunx convex run authorEarningsBackfill:run '{"dryRun": false}'

const DEFAULT_PAGE_SIZE = 100

const counterChange = v.object({
  id: v.string(),
  field: v.string(),
  before: v.number(),
  after: v.number(),
})

export const run = internalMutation({
  args: {
    table: v.union(v.literal('tips'), v.literal('highlightTips')),
    apply: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    apply: v.boolean(),
    table: v.string(),
    scanned: v.number(),
    unverified: v.array(
      v.object({
        id: v.string(),
        articleId: v.string(),
        createdAt: v.number(),
        amountUsd: v.number(),
      })
    ),
    counterChanges: v.array(counterChange),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const apply = args.apply === true
    const requested = Number.isFinite(args.pageSize)
      ? Math.floor(args.pageSize!)
      : DEFAULT_PAGE_SIZE
    const numItems = Math.min(Math.max(1, requested), 500)
    const page = await ctx.db
      .query(args.table)
      .withIndex('by_status', (q) => q.eq('status', CONFIRMED_TIP_STATUS))
      .paginate({ cursor: args.cursor ?? null, numItems })

    const legacy = page.page.filter(
      (tip) => !(typeof tip.verifiedAt === 'number' && tip.verifiedAt > 0)
    )

    const articleIds = new Set<Id<'articles'>>()
    const userIds = new Set<Id<'users'>>()
    for (const tip of legacy) {
      articleIds.add(tip.articleId)
      userIds.add(tip.tipperId)
      userIds.add(tip.authorId)
    }

    if (apply) {
      const now = Date.now()
      for (const tip of legacy) {
        await ctx.db.patch(tip._id, {
          status: UNVERIFIED_TIP_STATUS,
          failureReason: LEGACY_UNVERIFIED_TIP_REASON,
          updatedAt: now,
        })
      }
    }

    // Counters are computed as if the legacy rows were already excluded, so
    // the dry run shows the exact values an apply would write.
    const excluded = new Set<string>(legacy.map((tip) => tip._id))
    const counterChanges: {
      id: string
      field: string
      before: number
      after: number
    }[] = []

    for (const articleId of articleIds) {
      const article = await ctx.db.get(articleId)
      if (!article) continue
      const totals = await verifiedArticleTotals(ctx, articleId, excluded)
      const beforeCount = article.tipCount ?? 0
      const beforeUsd = article.totalTipsUsd ?? 0
      if (beforeCount !== totals.count) {
        counterChanges.push({
          id: articleId,
          field: 'articles.tipCount',
          before: beforeCount,
          after: totals.count,
        })
      }
      if (beforeUsd !== totals.usd) {
        counterChanges.push({
          id: articleId,
          field: 'articles.totalTipsUsd',
          before: beforeUsd,
          after: totals.usd,
        })
      }
      if (apply) {
        await ctx.db.patch(articleId, {
          tipCount: totals.count,
          totalTipsUsd: totals.usd,
        })
        await syncReadingRoomEngagement(ctx, articleId, {
          tipCount: totals.count,
        })
      }
    }

    for (const userId of userIds) {
      const user = await ctx.db.get(userId)
      if (!user) continue
      const counts = await verifiedUserCounts(ctx, userId, excluded)
      const beforeSent = user.tipsSentCount ?? 0
      const beforeReceived = user.tipsReceivedCount ?? 0
      if (beforeSent !== counts.sent) {
        counterChanges.push({
          id: userId,
          field: 'users.tipsSentCount',
          before: beforeSent,
          after: counts.sent,
        })
      }
      if (beforeReceived !== counts.received) {
        counterChanges.push({
          id: userId,
          field: 'users.tipsReceivedCount',
          before: beforeReceived,
          after: counts.received,
        })
      }
      if (apply) {
        await ctx.db.patch(userId, {
          tipsSentCount: counts.sent,
          tipsReceivedCount: counts.received,
        })
      }
    }

    return {
      apply,
      table: args.table,
      scanned: page.page.length,
      unverified: legacy.map((tip) => ({
        id: tip._id,
        articleId: tip.articleId,
        createdAt: tip.createdAt,
        amountUsd: tip.amountUsd,
      })),
      counterChanges,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

async function verifiedArticleTotals(
  ctx: MutationCtx,
  articleId: Id<'articles'>,
  excluded: Set<string>
) {
  const [articleTips, passageTips] = await Promise.all([
    ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', articleId))
      .filter(verifiedTipFilter)
      .collect(),
    ctx.db
      .query('highlightTips')
      .withIndex('by_article', (q) => q.eq('articleId', articleId))
      .filter(verifiedTipFilter)
      .collect(),
  ])
  const rows = [...articleTips, ...passageTips].filter(
    (tip) => !excluded.has(tip._id)
  )
  const cents = rows.reduce((sum, tip) => sum + tip.amountCents, 0)
  return { count: rows.length, usd: cents / 100 }
}

async function verifiedUserCounts(
  ctx: MutationCtx,
  userId: Id<'users'>,
  excluded: Set<string>
) {
  const count = async (
    table: 'tips' | 'highlightTips',
    index: 'by_tipper' | 'by_author'
  ) => {
    const rows = await ctx.db
      .query(table)
      .withIndex(index, (q) =>
        index === 'by_tipper'
          ? q.eq('tipperId', userId)
          : q.eq('authorId', userId)
      )
      .filter(verifiedTipFilter)
      .collect()
    return rows.filter((tip) => !excluded.has(tip._id)).length
  }
  const [sentA, sentP, receivedA, receivedP] = await Promise.all([
    count('tips', 'by_tipper'),
    count('highlightTips', 'by_tipper'),
    count('tips', 'by_author'),
    count('highlightTips', 'by_author'),
  ])
  return { sent: sentA + sentP, received: receivedA + receivedP }
}
