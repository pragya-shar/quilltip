/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { GenericMutationCtx } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import crons from './crons'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const emptyDoc = { type: 'doc', content: [] }
const SOURCE = 'G' + 'A'.repeat(55)
const DESTINATION = 'G' + 'B'.repeat(55)
const CONTRACT = 'C' + 'A'.repeat(55)
type Database = GenericMutationCtx<DataModel>
type LifecycleBase = {
  tipperId: Id<'users'>
  authorId: Id<'users'>
  articleId: Id<'articles'>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function seedBase(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: `tipper-${now}@x.test`,
      username: `tipper-${now}`,
      stellarAddress: SOURCE,
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: `author-${now}@x.test`,
      username: `author-${now}`,
      stellarAddress: DESTINATION,
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await ctx.db.insert('articles', {
      slug: `intent-lifecycle-${now}`,
      title: 'Intent lifecycle article',
      content: emptyDoc,
      published: true,
      publishedAt: now,
      authorId,
      authorUsername: `author-${now}`,
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

async function insertArticleIntent(
  ctx: Database,
  base: LifecycleBase,
  opts: { expiresAt: number; expectedMaxTime?: string }
): Promise<Id<'articleTipIntents'>> {
  const now = Date.now()
  return ctx.db.insert('articleTipIntents', {
    articleId: base.articleId,
    tipperId: base.tipperId,
    authorId: base.authorId,
    articleTitle: 'Intent lifecycle article',
    articleSlug: 'intent-lifecycle',
    amountUsd: 1,
    amountCents: 100,
    expectedSourceAccount: SOURCE,
    expectedDestinationAccount: DESTINATION,
    expectedArticleSymbol: 'intentarticle',
    expectedAmountStroops: '10000000',
    expectedContractId: CONTRACT,
    expectedMinTime: '1',
    expectedMaxTime: opts.expectedMaxTime ?? '2000000000',
    expectedStellarNetwork: 'TESTNET',
    quotePriceUsd: 0.1,
    quoteSource: 'test',
    quoteFetchedAt: now,
    expiresAt: opts.expiresAt,
    createdAt: now,
    updatedAt: now,
  })
}

async function insertHighlightIntent(
  ctx: Database,
  base: LifecycleBase,
  opts: { expiresAt: number; expectedMaxTime?: string }
): Promise<Id<'highlightTipIntents'>> {
  const now = Date.now()
  return ctx.db.insert('highlightTipIntents', {
    articleId: base.articleId,
    tipperId: base.tipperId,
    authorId: base.authorId,
    articleTitle: 'Intent lifecycle article',
    articleSlug: 'intent-lifecycle',
    highlightText: 'A passage',
    startOffset: 0,
    endOffset: 9,
    amountUsd: 1,
    amountCents: 100,
    expectedSourceAccount: SOURCE,
    expectedDestinationAccount: DESTINATION,
    expectedHighlightId: 'highlight-lifecycle',
    expectedArticleSymbol: 'intentarticle',
    expectedAmountStroops: '10000000',
    expectedContractId: CONTRACT,
    expectedMinTime: '1',
    expectedMaxTime: opts.expectedMaxTime ?? '2000000000',
    expectedStellarNetwork: 'TESTNET',
    quotePriceUsd: 0.1,
    quoteSource: 'test',
    quoteFetchedAt: now,
    expiresAt: opts.expiresAt,
    createdAt: now,
    updatedAt: now,
  })
}

async function linkArticleIntent(
  ctx: Database,
  base: LifecycleBase,
  intentId: Id<'articleTipIntents'>
): Promise<Id<'tips'>> {
  const now = Date.now()
  const tipId = await ctx.db.insert('tips', {
    articleId: base.articleId,
    articleTitle: 'Intent lifecycle article',
    articleSlug: 'intent-lifecycle',
    tipperId: base.tipperId,
    authorId: base.authorId,
    amountUsd: 1,
    amountCents: 100,
    stellarTxId: 'article-lifecycle-tx',
    stellarNetwork: 'TESTNET',
    articleTipIntentId: intentId,
    expectedSourceAccount: SOURCE,
    expectedDestinationAccount: DESTINATION,
    expectedArticleSymbol: 'intentarticle',
    expectedAmountStroops: '10000000',
    expectedContractId: CONTRACT,
    expectedMinTime: '1',
    expectedMaxTime: '2000000000',
    quotePriceUsd: 0.1,
    quoteSource: 'test',
    quoteFetchedAt: now,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  })
  await ctx.db.patch(intentId, { tipId })
  return tipId
}

async function linkHighlightIntent(
  ctx: Database,
  base: LifecycleBase,
  intentId: Id<'highlightTipIntents'>
): Promise<Id<'highlightTips'>> {
  const now = Date.now()
  const tipId = await ctx.db.insert('highlightTips', {
    highlightId: 'highlight-lifecycle',
    articleId: base.articleId,
    tipperId: base.tipperId,
    authorId: base.authorId,
    highlightText: 'A passage',
    articleTitle: 'Intent lifecycle article',
    articleSlug: 'intent-lifecycle',
    amountUsd: 1,
    amountCents: 100,
    stellarTxId: 'highlight-lifecycle-tx',
    stellarNetwork: 'TESTNET',
    stellarMemo: 'highlight-lifecycle',
    stellarSourceAccount: SOURCE,
    stellarDestinationAccount: DESTINATION,
    stellarAmountXlm: '1',
    highlightTipIntentId: intentId,
    expectedSourceAccount: SOURCE,
    expectedDestinationAccount: DESTINATION,
    expectedHighlightId: 'highlight-lifecycle',
    expectedArticleSymbol: 'intentarticle',
    expectedAmountStroops: '10000000',
    expectedContractId: CONTRACT,
    expectedMinTime: '1',
    expectedMaxTime: '2000000000',
    quotePriceUsd: 0.1,
    quoteSource: 'test',
    quoteFetchedAt: now,
    startOffset: 0,
    endOffset: 9,
    status: 'PENDING',
    createdAt: now,
    processedAt: now,
    updatedAt: now,
  })
  await ctx.db.patch(intentId, { tipId })
  return tipId
}

function stubHorizon(status: number) {
  vi.stubGlobal('fetch', async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  }))
}

function stubHorizonNetworkFailure() {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network unavailable')
  })
}

describe('tip intent lifecycle cleanup', () => {
  it('deletes no more than 100 expired unlinked intents per table and retains linked and live rows', async () => {
    const t = convexTest(schema, modules)
    const base = await seedBase(t)
    const expiredAt = Date.now() - 1
    const liveAt = Date.now() + 60_000
    const ids = await t.run(async (ctx) => {
      const articleExpired = await Promise.all(
        Array.from({ length: 101 }, () =>
          insertArticleIntent(ctx, base, { expiresAt: expiredAt })
        )
      )
      const highlightExpired = await Promise.all(
        Array.from({ length: 101 }, () =>
          insertHighlightIntent(ctx, base, { expiresAt: expiredAt })
        )
      )
      const articleLinked = await insertArticleIntent(ctx, base, {
        expiresAt: expiredAt,
      })
      const highlightLinked = await insertHighlightIntent(ctx, base, {
        expiresAt: expiredAt,
      })
      await linkArticleIntent(ctx, base, articleLinked)
      await linkHighlightIntent(ctx, base, highlightLinked)
      const articleLive = await insertArticleIntent(ctx, base, {
        expiresAt: liveAt,
      })
      const highlightLive = await insertHighlightIntent(ctx, base, {
        expiresAt: liveAt,
      })
      return {
        articleExpired,
        highlightExpired,
        articleLinked,
        highlightLinked,
        articleLive,
        highlightLive,
      }
    })

    await expect(
      t.action(internal.reconcileTips.cleanupExpiredTipIntents, {})
    ).resolves.toEqual({
      articleIntentsDeleted: 100,
      highlightIntentsDeleted: 100,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.articleExpired[0]!)).toBeNull()
      expect(await ctx.db.get(ids.highlightExpired[0]!)).toBeNull()
      expect(await ctx.db.get(ids.articleLinked)).not.toBeNull()
      expect(await ctx.db.get(ids.highlightLinked)).not.toBeNull()
      expect(await ctx.db.get(ids.articleLive)).not.toBeNull()
      expect(await ctx.db.get(ids.highlightLive)).not.toBeNull()
      expect(await ctx.db.query('articleTipIntents').collect()).toHaveLength(3)
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        3
      )
    })

    await expect(
      t.action(internal.reconcileTips.cleanupExpiredTipIntents, {})
    ).resolves.toEqual({ articleIntentsDeleted: 1, highlightIntentsDeleted: 1 })
    await expect(
      t.action(internal.reconcileTips.cleanupExpiredTipIntents, {})
    ).resolves.toEqual({ articleIntentsDeleted: 0, highlightIntentsDeleted: 0 })
  })
})

describe('post-window Horizon recovery', () => {
  it.each(['article', 'highlight'] as const)(
    'keeps an intent-backed %s tip pending when not_found is inside grace',
    async (kind) => {
      const t = convexTest(schema, modules)
      const base = await seedBase(t)
      const maxTime = String(Math.floor(Date.now() / 1000) - 5 * 60)
      const ids = await t.run(async (ctx) => {
        let tipId: Id<'tips'> | Id<'highlightTips'>
        if (kind === 'article') {
          const intent = await insertArticleIntent(ctx, base, {
            expiresAt: Date.now() - 1,
            expectedMaxTime: maxTime,
          })
          tipId = await linkArticleIntent(ctx, base, intent)
        } else {
          const intent = await insertHighlightIntent(ctx, base, {
            expiresAt: Date.now() - 1,
            expectedMaxTime: maxTime,
          })
          tipId = await linkHighlightIntent(ctx, base, intent)
        }
        await ctx.db.patch(tipId, { expectedMaxTime: maxTime })
        return { tipId }
      })
      stubHorizon(404)

      if (kind === 'article') {
        await t.action(internal.articleTipVerify.verifyArticleTip, {
          tipId: ids.tipId as Id<'tips'>,
          attempt: 3,
        })
      } else {
        await t.action(internal.stellarVerify.verifyHighlightTip, {
          highlightTipId: ids.tipId as Id<'highlightTips'>,
          attempt: 3,
        })
      }

      await t.run(async (ctx) => {
        expect(await ctx.db.get(ids.tipId)).toMatchObject({
          status: 'PENDING',
          failureReason: 'verification_temporarily_unavailable',
        })
      })
    }
  )

  it.each(['article', 'highlight'] as const)(
    'marks an intent-backed %s tip terminal after its time bound and indexing grace when Horizon reports not_found',
    async (kind) => {
      const t = convexTest(schema, modules)
      const base = await seedBase(t)
      const maxTime = String(Math.floor(Date.now() / 1000) - 11 * 60)
      const ids = await t.run(async (ctx) => {
        let tipId: Id<'tips'> | Id<'highlightTips'>
        if (kind === 'article') {
          const intent = await insertArticleIntent(ctx, base, {
            expiresAt: Date.now() - 1,
            expectedMaxTime: maxTime,
          })
          tipId = await linkArticleIntent(ctx, base, intent)
        } else {
          const intent = await insertHighlightIntent(ctx, base, {
            expiresAt: Date.now() - 1,
            expectedMaxTime: maxTime,
          })
          tipId = await linkHighlightIntent(ctx, base, intent)
        }
        await ctx.db.patch(tipId, { expectedMaxTime: maxTime })
        return { tipId }
      })
      stubHorizon(404)

      if (kind === 'article') {
        await t.action(internal.articleTipVerify.verifyArticleTip, {
          tipId: ids.tipId as Id<'tips'>,
          attempt: 1,
        })
        await t.action(internal.articleTipVerify.verifyArticleTip, {
          tipId: ids.tipId as Id<'tips'>,
          attempt: 1,
        })
      } else {
        await t.action(internal.stellarVerify.verifyHighlightTip, {
          highlightTipId: ids.tipId as Id<'highlightTips'>,
          attempt: 1,
        })
        await t.action(internal.stellarVerify.verifyHighlightTip, {
          highlightTipId: ids.tipId as Id<'highlightTips'>,
          attempt: 1,
        })
      }

      await t.run(async (ctx) => {
        expect(await ctx.db.get(ids.tipId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'transaction_not_found_after_indexing_grace',
        })
        expect((await ctx.db.get(base.articleId))?.tipCount).toBe(0)
        expect((await ctx.db.get(base.tipperId))?.tipsSentCount).toBe(0)
        expect((await ctx.db.get(base.authorId))?.tipsReceivedCount).toBe(0)
      })
    }
  )

  it.each(['article', 'highlight'] as const)(
    'keeps an intent-backed %s tip retryable after the grace window for network and server failures',
    async (kind) => {
      for (const failure of ['network', 'server'] as const) {
        const t = convexTest(schema, modules)
        const base = await seedBase(t)
        const maxTime = String(Math.floor(Date.now() / 1000) - 11 * 60)
        const ids = await t.run(async (ctx) => {
          let tipId: Id<'tips'> | Id<'highlightTips'>
          if (kind === 'article') {
            const intent = await insertArticleIntent(ctx, base, {
              expiresAt: Date.now() - 1,
              expectedMaxTime: maxTime,
            })
            tipId = await linkArticleIntent(ctx, base, intent)
          } else {
            const intent = await insertHighlightIntent(ctx, base, {
              expiresAt: Date.now() - 1,
              expectedMaxTime: maxTime,
            })
            tipId = await linkHighlightIntent(ctx, base, intent)
          }
          await ctx.db.patch(tipId, { expectedMaxTime: maxTime })
          return { tipId }
        })
        if (failure === 'network') stubHorizonNetworkFailure()
        else stubHorizon(503)

        if (kind === 'article') {
          await t.action(internal.articleTipVerify.verifyArticleTip, {
            tipId: ids.tipId as Id<'tips'>,
            attempt: 3,
          })
        } else {
          await t.action(internal.stellarVerify.verifyHighlightTip, {
            highlightTipId: ids.tipId as Id<'highlightTips'>,
            attempt: 3,
          })
        }

        await t.run(async (ctx) => {
          expect(await ctx.db.get(ids.tipId)).toMatchObject({
            status: 'PENDING',
            failureReason: 'verification_temporarily_unavailable',
          })
        })
        vi.unstubAllGlobals()
      }
    }
  )
})

describe('tip intent lifecycle cron', () => {
  it('runs the bounded intent cleanup every hour', () => {
    expect(crons.crons['cleanup expired tip intents']).toMatchObject({
      name: 'reconcileTips:cleanupExpiredTipIntents',
      schedule: { type: 'interval', hours: 1 },
    })
  })
})
