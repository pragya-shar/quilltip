import { v } from 'convex/values'
import { internalQuery } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { loadTestAccountIds } from './lib/testAccounts'

// Usage metrics for the beta. Internal only: callable from the Convex
// dashboard or CLI by someone with deployment access, never from the app.
//   bunx convex run betaMetrics:getUsageMetrics
//   bunx convex run betaMetrics:getUsageMetrics '{"excludeTestAccounts":false}'
//
// Test accounts are excluded by default. A tip is excluded when either the
// tipper or the writer is a test account. Tip counts are reported by status;
// `verified` counts CONFIRMED rows that carry a server verification time.
// Reads whole tables, which suits beta-sized data; move to aggregates before
// the tables grow past Convex's per-query read limits.

type TipRow = Doc<'tips'> | Doc<'highlightTips'>

function tipSummary(rows: TipRow[]) {
  const byStatus: Record<string, number> = {}
  let verified = 0
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    if (
      row.status === 'CONFIRMED' &&
      typeof row.verifiedAt === 'number' &&
      row.verifiedAt > 0
    ) {
      verified++
    }
  }
  return { total: rows.length, verified, byStatus }
}

export const getUsageMetrics = internalQuery({
  args: { excludeTestAccounts: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const exclude = args.excludeTestAccounts !== false
    const testIds = await loadTestAccountIds(ctx)
    const isTest = (id: Doc<'users'>['_id']) => exclude && testIds.has(id)

    const users = (await ctx.db.query('users').collect()).filter(
      (user) => !isTest(user._id)
    )
    const articles = (await ctx.db.query('articles').collect()).filter(
      (article) => !isTest(article.authorId)
    )
    const highlights = (await ctx.db.query('highlights').collect()).filter(
      (highlight) =>
        !isTest(highlight.userId) && highlight.removedAt === undefined
    )
    const keepTip = (tip: TipRow) =>
      !isTest(tip.tipperId) && !isTest(tip.authorId)
    const articleTips = (await ctx.db.query('tips').collect()).filter(keepTip)
    const passageTips = (await ctx.db.query('highlightTips').collect()).filter(
      keepTip
    )
    const waitlist = await ctx.db.query('waitlist').collect()
    const feedback = (await ctx.db.query('feedback').collect()).filter(
      (row) => !isTest(row.userId)
    )

    const verifiedTippers = new Set<string>()
    const anyTippers = new Set<string>()
    for (const tip of [...articleTips, ...passageTips]) {
      anyTippers.add(tip.tipperId)
      if (
        tip.status === 'CONFIRMED' &&
        typeof tip.verifiedAt === 'number' &&
        tip.verifiedAt > 0
      ) {
        verifiedTippers.add(tip.tipperId)
      }
    }

    const waitlistByStatus: Record<string, number> = {}
    for (const row of waitlist) {
      const status = row.status ?? 'pending'
      waitlistByStatus[status] = (waitlistByStatus[status] ?? 0) + 1
    }

    return {
      generatedAt: Date.now(),
      excludeTestAccounts: exclude,
      testAccountsExcluded: exclude ? testIds.size : 0,
      users: {
        total: users.length,
        withWallet: users.filter(
          (user) =>
            typeof user.stellarAddress === 'string' &&
            user.stellarAddress.length > 0
        ).length,
      },
      articles: {
        total: articles.length,
        published: articles.filter((article) => article.published).length,
        drafts: articles.filter((article) => !article.published).length,
      },
      highlights: {
        total: highlights.length,
        public: highlights.filter((highlight) => highlight.isPublic).length,
      },
      tips: {
        article: tipSummary(articleTips),
        passage: tipSummary(passageTips),
        distinctTippers: anyTippers.size,
        distinctVerifiedTippers: verifiedTippers.size,
      },
      waitlist: { total: waitlist.length, byStatus: waitlistByStatus },
      feedback: { total: feedback.length },
    }
  },
})
