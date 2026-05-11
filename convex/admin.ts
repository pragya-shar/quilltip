import { v } from 'convex/values'
import { query } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import type { Doc } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

type StatusCounts = Record<string, number>

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

async function requireAdmin(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error('Admin access required')

  const user = await ctx.db.get(userId)
  if (!user) throw new Error('Admin access required')

  const allowlist = adminEmails()
  if (!allowlist.has(user.email.toLowerCase())) {
    throw new Error('Admin access required')
  }

  return user
}

function countByStatus(rows: Array<{ status: string }>): StatusCounts {
  return rows.reduce<StatusCounts>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1
    return acc
  }, {})
}

function amountCents(row: { amountCents?: number; amountUsd: number }): number {
  return row.amountCents ?? Math.round(row.amountUsd * 100 + Number.EPSILON)
}

function totalConfirmedCents(
  rows: Array<{ status: string; amountCents?: number; amountUsd: number }>
): number {
  return rows
    .filter((row) => row.status === 'CONFIRMED')
    .reduce((sum, row) => sum + amountCents(row), 0)
}

function explorerUrl(txId: string | undefined, network: string | undefined) {
  if (!txId) return undefined
  const segment = network === 'MAINNET' ? 'public' : 'testnet'
  return `https://stellar.expert/explorer/${segment}/tx/${txId}`
}

function recentArticleTip(tip: Doc<'tips'>) {
  return {
    id: tip._id,
    type: 'article' as const,
    status: tip.status,
    amountCents: amountCents(tip),
    amountUsd: amountCents(tip) / 100,
    articleTitle: tip.articleTitle,
    articleSlug: tip.articleSlug,
    tipperName: tip.tipperName,
    authorName: tip.authorName,
    stellarTxId: tip.stellarTxId,
    stellarNetwork: tip.stellarNetwork,
    stellarExplorerUrl: explorerUrl(tip.stellarTxId, tip.stellarNetwork),
    createdAt: tip.createdAt,
  }
}

function recentHighlightTip(tip: Doc<'highlightTips'>) {
  return {
    id: tip._id,
    type: 'highlight' as const,
    status: tip.status,
    amountCents: amountCents(tip),
    amountUsd: amountCents(tip) / 100,
    articleTitle: tip.articleTitle,
    articleSlug: tip.articleSlug,
    highlightText: tip.highlightText,
    tipperName: tip.tipperName,
    authorName: tip.authorName,
    stellarTxId: tip.stellarTxId,
    stellarNetwork: tip.stellarNetwork,
    stellarExplorerUrl: explorerUrl(tip.stellarTxId, tip.stellarNetwork),
    createdAt: tip.createdAt,
  }
}

export const getStats = query({
  args: {
    recentLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    const [users, articles, articleTips, highlightTips] = await Promise.all([
      ctx.db.query('users').collect(),
      ctx.db.query('articles').collect(),
      ctx.db.query('tips').collect(),
      ctx.db.query('highlightTips').collect(),
    ])

    const confirmedTips = articleTips.filter(
      (tip) => tip.status === 'CONFIRMED'
    )
    const confirmedHighlightTips = highlightTips.filter(
      (tip) => tip.status === 'CONFIRMED'
    )

    const confirmedTippers = new Set([
      ...confirmedTips.map((tip) => tip.tipperId),
      ...confirmedHighlightTips.map((tip) => tip.tipperId),
    ])
    const confirmedWriters = new Set([
      ...confirmedTips.map((tip) => tip.authorId),
      ...confirmedHighlightTips.map((tip) => tip.authorId),
    ])

    const recentLimit = Math.min(Math.max(args.recentLimit ?? 10, 1), 50)
    const recentTransactions = [
      ...articleTips.map(recentArticleTip),
      ...highlightTips.map(recentHighlightTip),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, recentLimit)

    const suspiciousCount = highlightTips.filter(
      (tip) => tip.amountUsdSuspicious === true
    ).length
    const fraudulentCount = articleTips.filter(
      (tip) => tip.status === 'FRAUDULENT'
    ).length
    const failedCount =
      articleTips.filter((tip) => tip.status === 'FAILED').length +
      highlightTips.filter((tip) => tip.status === 'FAILED').length

    return {
      generatedAt: Date.now(),
      users: {
        total: users.length,
        withStellarAddress: users.filter((user) => Boolean(user.stellarAddress))
          .length,
        onboardingCompleted: users.filter(
          (user) => user.onboardingCompleted === true
        ).length,
      },
      articles: {
        total: articles.length,
        published: articles.filter((article) => article.published).length,
        drafts: articles.filter((article) => !article.published).length,
        publishedWriters: new Set(
          articles
            .filter((article) => article.published)
            .map((article) => article.authorId)
        ).size,
      },
      articleTips: {
        total: articleTips.length,
        byStatus: countByStatus(articleTips),
        confirmedCount: confirmedTips.length,
        totalConfirmedVolumeCents: totalConfirmedCents(articleTips),
      },
      highlightTips: {
        total: highlightTips.length,
        byStatus: countByStatus(highlightTips),
        confirmedCount: confirmedHighlightTips.length,
        totalConfirmedVolumeCents: totalConfirmedCents(highlightTips),
      },
      transactions: {
        totalCount: articleTips.length + highlightTips.length,
        confirmedCount: confirmedTips.length + confirmedHighlightTips.length,
        failedCount,
        suspiciousCount,
        fraudulentCount,
        totalConfirmedVolumeCents:
          totalConfirmedCents(articleTips) + totalConfirmedCents(highlightTips),
        uniqueConfirmedTippers: confirmedTippers.size,
        uniqueConfirmedWriters: confirmedWriters.size,
      },
      recentTransactions,
    }
  },
})
