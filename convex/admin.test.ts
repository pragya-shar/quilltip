/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const emptyDoc = { type: 'doc', content: [] }
const getStatsRef = api.admin.getStats

async function seedStatsFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = 1_700_000_000_000
    const adminId = await ctx.db.insert('users', {
      email: 'admin@quilltip.test',
      username: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    const readerId = await ctx.db.insert('users', {
      email: 'reader@quilltip.test',
      username: 'reader',
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@quilltip.test',
      username: 'author',
      createdAt: now,
      updatedAt: now,
    })
    const articleId: Id<'articles'> = await ctx.db.insert('articles', {
      slug: 'evidence',
      title: 'Evidence Article',
      content: emptyDoc,
      published: true,
      publishedAt: now,
      authorId,
      authorUsername: 'author',
      tags: [],
      viewCount: 0,
      highlightCount: 0,
      tipCount: 0,
      totalTipsUsd: 0,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('articles', {
      slug: 'draft',
      title: 'Draft Article',
      content: emptyDoc,
      published: false,
      authorId,
      authorUsername: 'author',
      tags: [],
      viewCount: 0,
      highlightCount: 0,
      tipCount: 0,
      totalTipsUsd: 0,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('tips', {
      articleId,
      articleTitle: 'Evidence Article',
      articleSlug: 'evidence',
      tipperId: readerId,
      tipperName: 'Reader',
      authorId,
      authorName: 'Author',
      amountUsd: 1.5,
      amountCents: 150,
      stellarTxId: 'article-confirmed-tx',
      stellarNetwork: 'TESTNET',
      status: 'CONFIRMED',
      createdAt: now + 1,
      updatedAt: now + 1,
    })
    await ctx.db.insert('tips', {
      articleId,
      articleTitle: 'Evidence Article',
      articleSlug: 'evidence',
      tipperId: readerId,
      authorId,
      amountUsd: 2,
      amountCents: 200,
      stellarTxId: 'article-failed-tx',
      stellarNetwork: 'TESTNET',
      status: 'FAILED',
      failureReason: 'test failure',
      createdAt: now + 2,
      updatedAt: now + 2,
    })
    await ctx.db.insert('highlightTips', {
      highlightId: 'hash-1',
      articleId,
      tipperId: readerId,
      authorId,
      highlightText: 'quoted line',
      articleTitle: 'Evidence Article',
      articleSlug: 'evidence',
      amountUsd: 0.5,
      amountCents: 50,
      stellarTxId: 'highlight-confirmed-tx',
      stellarNetwork: 'TESTNET',
      stellarMemo: 'hash-1',
      startOffset: 0,
      endOffset: 10,
      status: 'CONFIRMED',
      createdAt: now + 3,
      processedAt: now + 3,
      updatedAt: now + 3,
    })

    return { adminId, readerId }
  })
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS
})

describe('admin.getStats', () => {
  it('rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    process.env.ADMIN_EMAILS = 'admin@quilltip.test'

    await expect(t.query(getStatsRef, {})).rejects.toThrow(
      'Admin access required'
    )
  })

  it('rejects authenticated users whose email is not allowlisted', async () => {
    const t = convexTest(schema, modules)
    const { readerId } = await seedStatsFixture(t)
    process.env.ADMIN_EMAILS = 'admin@quilltip.test'

    await expect(
      t.withIdentity({ subject: readerId }).query(getStatsRef, {})
    ).rejects.toThrow('Admin access required')
  })

  it('returns aggregate evidence metrics for allowlisted admins', async () => {
    const t = convexTest(schema, modules)
    const { adminId } = await seedStatsFixture(t)
    process.env.ADMIN_EMAILS = 'admin@quilltip.test, other@quilltip.test'

    const stats = await t
      .withIdentity({ subject: adminId })
      .query(getStatsRef, {
        recentLimit: 5,
      })

    expect(stats.users.total).toBe(3)
    expect(stats.articles.published).toBe(1)
    expect(stats.articleTips.byStatus).toEqual({ CONFIRMED: 1, FAILED: 1 })
    expect(stats.highlightTips.byStatus).toEqual({ CONFIRMED: 1 })
    expect(stats.transactions.confirmedCount).toBe(2)
    expect(stats.transactions.totalCount).toBe(3)
    expect(stats.transactions.totalConfirmedVolumeCents).toBe(200)
    expect(stats.transactions.uniqueConfirmedTippers).toBe(1)
    expect(stats.transactions.uniqueConfirmedWriters).toBe(1)
    expect(
      stats.recentTransactions.map(
        (tx: { stellarTxId?: string }) => tx.stellarTxId
      )
    ).toEqual([
      'highlight-confirmed-tx',
      'article-failed-tx',
      'article-confirmed-tx',
    ])
  })
})
