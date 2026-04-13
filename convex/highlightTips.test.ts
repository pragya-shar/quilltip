/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'tipper@x.test',
      username: 'tipper',
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await ctx.db.insert('articles', {
      slug: 'hello',
      title: 'Hello',
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
    return { tipperId, authorId, articleId }
  })
}

function tipArgs(articleId: Id<'articles'>, stellarTxId: string) {
  return {
    highlightId: 'hash-abc',
    articleId,
    highlightText: 'some highlighted text',
    startOffset: 0,
    endOffset: 10,
    amountCents: 100,
    stellarTxId,
    stellarMemo: 'hash-abc',
  }
}

describe('highlightTips.create', () => {
  it('dedups on non-empty stellarTxId', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    expect(second).toBe(first)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(1)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount).toBe(1)
    })
  })

  it('does not dedup when stellarTxId is empty', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, '')
    )
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, '')
    )

    expect(second).not.toBe(first)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(2)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(2)
    })
  })

  it('does not dedup distinct non-empty stellarTxIds', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-2')
    )

    expect(second).not.toBe(first)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(2)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(2)
    })
  })
})
