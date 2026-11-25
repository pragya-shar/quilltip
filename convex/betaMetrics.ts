import { v } from 'convex/values'
import { internalAction, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { loadTestAccountIds } from './lib/testAccounts'

// Usage metrics for the beta. Internal only: callable from the Convex
// dashboard or CLI by someone with deployment access, never from the app.
//   bunx convex run betaMetrics:getUsageMetrics
//   bunx convex run betaMetrics:getUsageMetrics '{"excludeTestAccounts":false}'
//
// Test accounts are excluded by default. A tip is excluded when either the
// tipper or the writer is a test account. Tip counts are reported by status;
// `verified` counts CONFIRMED rows that carry a server verification time.
// Each table is read in pages by a separate query, so no single query reads a
// whole table. The result is a near-snapshot, not a single transaction.

const PAGE_SIZE = 100

const metricsTable = v.union(
  v.literal('users'),
  v.literal('articles'),
  v.literal('highlights'),
  v.literal('tips'),
  v.literal('highlightTips'),
  v.literal('waitlist'),
  v.literal('feedback')
)
type MetricsTable =
  | 'users'
  | 'articles'
  | 'highlights'
  | 'tips'
  | 'highlightTips'
  | 'waitlist'
  | 'feedback'

const METRICS_TABLES: MetricsTable[] = [
  'users',
  'articles',
  'highlights',
  'tips',
  'highlightTips',
  'waitlist',
  'feedback',
]

type TipRow = Doc<'tips'> | Doc<'highlightTips'>

function isVerifiedTip(tip: TipRow) {
  return (
    tip.status === 'CONFIRMED' &&
    typeof tip.verifiedAt === 'number' &&
    tip.verifiedAt > 0
  )
}

type PageCounts = {
  counts: Record<string, number>
  tippers: string[]
  verifiedTippers: string[]
}

/** Counts one page of one table. Internal; used by getUsageMetrics. */
export const countPage = internalQuery({
  args: {
    table: metricsTable,
    cursor: v.union(v.string(), v.null()),
    excludeTestAccounts: v.boolean(),
  },
  handler: async (ctx, args) => {
    const testIds = args.excludeTestAccounts
      ? await loadTestAccountIds(ctx)
      : new Set<Id<'users'>>()
    const isTest = (id: Id<'users'>) => testIds.has(id)
    const out: PageCounts = { counts: {}, tippers: [], verifiedTippers: [] }
    const add = (key: string, by = 1) => {
      out.counts[key] = (out.counts[key] ?? 0) + by
    }
    const paginationOpts = { cursor: args.cursor, numItems: PAGE_SIZE }

    const countTips = (prefix: string, rows: TipRow[]) => {
      for (const tip of rows) {
        if (isTest(tip.tipperId) || isTest(tip.authorId)) continue
        add(`${prefix}.total`)
        add(`${prefix}.byStatus.${tip.status}`)
        out.tippers.push(tip.tipperId)
        if (isVerifiedTip(tip)) {
          add(`${prefix}.verified`)
          out.verifiedTippers.push(tip.tipperId)
        }
      }
    }

    let page: { isDone: boolean; continueCursor: string }
    switch (args.table) {
      case 'users': {
        const result = await ctx.db.query('users').paginate(paginationOpts)
        for (const user of result.page) {
          if (isTest(user._id)) continue
          add('users.total')
          if (
            typeof user.stellarAddress === 'string' &&
            user.stellarAddress.length > 0
          ) {
            add('users.withWallet')
          }
        }
        page = result
        break
      }
      case 'articles': {
        const result = await ctx.db.query('articles').paginate(paginationOpts)
        for (const article of result.page) {
          if (isTest(article.authorId)) continue
          add('articles.total')
          add(article.published ? 'articles.published' : 'articles.drafts')
        }
        page = result
        break
      }
      case 'highlights': {
        const result = await ctx.db.query('highlights').paginate(paginationOpts)
        for (const highlight of result.page) {
          if (isTest(highlight.userId) || highlight.removedAt !== undefined) {
            continue
          }
          add('highlights.total')
          if (highlight.isPublic) add('highlights.public')
        }
        page = result
        break
      }
      case 'tips': {
        const result = await ctx.db.query('tips').paginate(paginationOpts)
        countTips('tips.article', result.page)
        page = result
        break
      }
      case 'highlightTips': {
        const result = await ctx.db
          .query('highlightTips')
          .paginate(paginationOpts)
        countTips('tips.passage', result.page)
        page = result
        break
      }
      case 'waitlist': {
        const result = await ctx.db.query('waitlist').paginate(paginationOpts)
        for (const row of result.page) {
          add('waitlist.total')
          add(`waitlist.byStatus.${row.status ?? 'pending'}`)
        }
        page = result
        break
      }
      case 'feedback': {
        const result = await ctx.db.query('feedback').paginate(paginationOpts)
        for (const row of result.page) {
          if (!isTest(row.userId)) add('feedback.total')
        }
        page = result
        break
      }
    }
    return {
      ...out,
      testAccounts: testIds.size,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

export const getUsageMetrics = internalAction({
  args: { excludeTestAccounts: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const exclude = args.excludeTestAccounts !== false
    const counts: Record<string, number> = {}
    const tippers = new Set<string>()
    const verifiedTippers = new Set<string>()
    let testAccounts = 0

    for (const table of METRICS_TABLES) {
      let cursor: string | null = null
      for (;;) {
        const page: PageCounts & {
          testAccounts: number
          isDone: boolean
          continueCursor: string
        } = await ctx.runQuery(internal.betaMetrics.countPage, {
          table,
          cursor,
          excludeTestAccounts: exclude,
        })
        for (const [key, value] of Object.entries(page.counts)) {
          counts[key] = (counts[key] ?? 0) + value
        }
        page.tippers.forEach((id) => tippers.add(id))
        page.verifiedTippers.forEach((id) => verifiedTippers.add(id))
        testAccounts = page.testAccounts
        if (page.isDone) break
        cursor = page.continueCursor
      }
    }

    const count = (key: string) => counts[key] ?? 0
    const byStatus = (prefix: string) => {
      const result: Record<string, number> = {}
      for (const [key, value] of Object.entries(counts)) {
        if (key.startsWith(`${prefix}.byStatus.`)) {
          result[key.slice(prefix.length + '.byStatus.'.length)] = value
        }
      }
      return result
    }
    const tipSummary = (prefix: string) => ({
      total: count(`${prefix}.total`),
      verified: count(`${prefix}.verified`),
      byStatus: byStatus(prefix),
    })

    return {
      generatedAt: Date.now(),
      excludeTestAccounts: exclude,
      testAccountsExcluded: exclude ? testAccounts : 0,
      users: {
        total: count('users.total'),
        withWallet: count('users.withWallet'),
      },
      articles: {
        total: count('articles.total'),
        published: count('articles.published'),
        drafts: count('articles.drafts'),
      },
      highlights: {
        total: count('highlights.total'),
        public: count('highlights.public'),
      },
      tips: {
        article: tipSummary('tips.article'),
        passage: tipSummary('tips.passage'),
        distinctTippers: tippers.size,
        distinctVerifiedTippers: verifiedTippers.size,
      },
      waitlist: {
        total: count('waitlist.total'),
        byStatus: byStatus('waitlist'),
      },
      feedback: { total: count('feedback.total') },
    }
  },
})
