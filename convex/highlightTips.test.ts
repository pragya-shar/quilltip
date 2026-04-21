/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const TIPPER_STELLAR = 'GTIPPER0000000000000000000000000000000000000000000000AA'

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
    stellarSourceAccount: TIPPER_STELLAR,
  }
}

// Skips the Horizon round-trip by directly invoking the internal mutation
// that verification would have called on success. Used by tests that want
// to exercise the final CONFIRMED state without stubbing fetch.
async function confirmPending(
  t: ReturnType<typeof convexTest>,
  tipId: Id<'highlightTips'>
) {
  await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
    id: tipId,
    stellarLedger: 1,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('highlightTips.create', () => {
  it('inserts the tip as PENDING with counters untouched', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('PENDING')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)
      expect(article?.totalTipsUsd ?? 0).toBe(0)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount ?? 0).toBe(0)
    })
  })

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

    // Counters bump only after verification; confirm the original to prove
    // dedup didn't accidentally double-credit the tip.
    await confirmPending(t, first)

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
    // Backdate so the cooldown does not block the second empty-tx insert.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, '')
    )

    expect(second).not.toBe(first)

    await confirmPending(t, first)
    await confirmPending(t, second)

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
    // Backdate the first tip so the cooldown does not block the second insert.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-2')
    )

    expect(second).not.toBe(first)

    await confirmPending(t, first)
    await confirmPending(t, second)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(2)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(2)
    })
  })

  it('rejects a second distinct-tx tip within the cooldown window', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await expect(
      asTipper.mutation(
        api.highlightTips.create,
        tipArgs(articleId, 'stellar-tx-2')
      )
    ).rejects.toThrow(/wait .* before tipping again/i)
  })

  it('allows a second tip once the cooldown has elapsed', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    // Backdate the first tip so its createdAt is older than TIP_COOLDOWN_MS.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-2')
    )
    expect(second).not.toBe(first)
  })

  it('still dedups a retried stellarTxId even within the cooldown', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    const retried = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    expect(retried).toBe(first)
  })

  it('hides PENDING tips from the public heatmap queries', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    const byArticle = await t.query(api.highlightTips.getByArticle, {
      articleId,
    })
    expect(byArticle).toHaveLength(0)

    const stats = await t.query(api.highlightTips.getArticleStats, {
      articleId,
    })
    expect(stats.totalTips).toBe(0)
    expect(stats.totalAmountCents).toBe(0)
  })
})

describe('markHighlightTipConfirmed', () => {
  it('flips PENDING to CONFIRMED and applies counter updates', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await confirmPending(t, tipId)

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.stellarLedger).toBe(1)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount).toBe(1)

      const author = await ctx.db.get(authorId)
      expect(author?.tipsReceivedCount).toBe(1)
    })
  })

  it('is a no-op when called twice on the same tip', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await confirmPending(t, tipId)
    await confirmPending(t, tipId)

    await t.run(async (ctx) => {
      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)
    })
  })
})

describe('markHighlightTipFailed', () => {
  it('flips PENDING to FAILED and leaves counters untouched', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await t.mutation(internal.stellarVerify.markHighlightTipFailed, {
      id: tipId,
      reason: 'source_mismatch',
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('source_mismatch')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)

      const author = await ctx.db.get(authorId)
      expect(author?.tipsReceivedCount ?? 0).toBe(0)
    })
  })

  it('cannot downgrade a CONFIRMED tip back to FAILED', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    await confirmPending(t, tipId)

    await t.mutation(internal.stellarVerify.markHighlightTipFailed, {
      id: tipId,
      reason: 'late_failure',
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
    })
  })
})

describe('verifyHighlightTip action', () => {
  it('flips to CONFIRMED when Horizon returns a matching success', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        successful: true,
        source_account: TIPPER_STELLAR,
        ledger: 999,
      }),
    }))

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.stellarLedger).toBe(999)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
    })
  })

  it('flips to FAILED on a source-account mismatch', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        successful: true,
        source_account: 'GATTACKER',
        ledger: 999,
      }),
    }))

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('source_mismatch')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)
    })
  })
})
