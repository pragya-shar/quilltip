/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { beforeAll, describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const TIPPER_STELLAR_ADDRESS = `G${'A'.repeat(55)}`
const AUTHOR_STELLAR_ADDRESS = `G${'B'.repeat(55)}`
const TIPPING_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = TIPPING_CONTRACT_ID
  process.env.STELLAR_NETWORK = 'TESTNET'
})

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'tipper@x.test',
      username: 'tipper',
      name: 'Tipper',
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      name: 'Author',
      stellarAddress: AUTHOR_STELLAR_ADDRESS,
      createdAt: now,
      updatedAt: now,
    })
    const articleId: Id<'articles'> = await ctx.db.insert('articles', {
      slug: 'hello',
      title: 'Hello',
      content: emptyDoc,
      published: true,
      publishedAt: now,
      authorId,
      authorUsername: 'author',
      tags: [],
      tipCount: 0,
      totalTipsUsd: 0,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('xlmPriceCache', {
      priceUsd: 0.25,
      source: 'TestOracle',
      fetchedAt: now,
    })
    return { tipperId, authorId, articleId }
  })
}

function prepareArgs(articleId: Id<'articles'>, startOffset = 4) {
  return {
    articleId,
    highlightText: 'authoritative passage',
    startOffset,
    endOffset: startOffset + 15,
    startContainerPath: '0.0',
    endContainerPath: '0.0',
    amountCents: 500,
    message: 'This line stayed with me.',
    stellarSourceAccount: TIPPER_STELLAR_ADDRESS,
  }
}

async function prepare(t: ReturnType<typeof convexTest>) {
  const seeded = await seed(t)
  const asTipper = t.withIdentity({ subject: seeded.tipperId })
  const quote = await asTipper.mutation(
    api.highlightTips.prepareHighlightTip,
    prepareArgs(seeded.articleId)
  )
  return { ...seeded, asTipper, quote }
}

describe('prepareHighlightTip', () => {
  it('freezes canonical selection and payment fields without crediting the author', async () => {
    const t = convexTest(schema, modules)
    const startedAt = Date.now()
    const { tipperId, authorId, articleId } = await seed(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const quote = await asTipper.mutation(
      api.highlightTips.prepareHighlightTip,
      prepareArgs(articleId)
    )

    expect(quote).toEqual({
      intentId: expect.any(String),
      highlightId: 'a8c43973f58687260eb4de09f96b',
      articleSymbol: '2ede2c6a40',
      authorAddress: AUTHOR_STELLAR_ADDRESS,
      amountStroops: 200_000_000,
      stellarNetwork: 'TESTNET',
      contractId: TIPPING_CONTRACT_ID,
      timeBounds: {
        minTime: expect.stringMatching(/^\d+$/),
        maxTime: expect.stringMatching(/^\d+$/),
      },
    })

    const state = await t.run(async (ctx) => ({
      intent: await ctx.db.get(quote.intentId),
      tips: await ctx.db.query('highlightTips').collect(),
      article: await ctx.db.get(articleId),
      earnings: await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first(),
    }))
    expect(state.intent).toMatchObject({
      articleId,
      tipperId,
      authorId,
      highlightText: 'authoritative passage',
      startOffset: 4,
      endOffset: 19,
      startContainerPath: '0.0',
      endContainerPath: '0.0',
      amountCents: 500,
      amountUsd: 5,
      message: 'This line stayed with me.',
      expectedSourceAccount: TIPPER_STELLAR_ADDRESS,
      expectedDestinationAccount: AUTHOR_STELLAR_ADDRESS,
      expectedHighlightId: 'a8c43973f58687260eb4de09f96b',
      expectedArticleSymbol: '2ede2c6a40',
      expectedAmountStroops: '200000000',
      expectedStellarNetwork: 'TESTNET',
      expectedContractId: TIPPING_CONTRACT_ID,
      expectedMinTime: quote.timeBounds.minTime,
      expectedMaxTime: quote.timeBounds.maxTime,
      quotePriceUsd: 0.25,
      quoteSource: 'TestOracle',
    })
    expect(state.intent?.expiresAt).toBeGreaterThanOrEqual(
      startedAt + 15 * 60 * 1000
    )
    expect(state.intent?.expiresAt).toBeLessThanOrEqual(
      Date.now() + 15 * 60 * 1000
    )
    expect(quote.timeBounds.maxTime).toBe(
      Math.floor(state.intent!.expiresAt / 1000).toString()
    )
    expect(state.tips).toHaveLength(0)
    expect(state.article?.tipCount).toBe(0)
    expect(state.article?.totalTipsUsd).toBe(0)
    expect(state.earnings).toBeNull()
  })

  it('reuses an identical outstanding intent and caps distinct outstanding intents at five', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)
    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.prepareHighlightTip,
      prepareArgs(articleId)
    )
    const duplicate = await asTipper.mutation(
      api.highlightTips.prepareHighlightTip,
      prepareArgs(articleId)
    )
    expect(duplicate).toEqual(first)

    for (const startOffset of [20, 40, 60, 80]) {
      await asTipper.mutation(
        api.highlightTips.prepareHighlightTip,
        prepareArgs(articleId, startOffset)
      )
    }

    await expect(
      asTipper.mutation(
        api.highlightTips.prepareHighlightTip,
        prepareArgs(articleId, 100)
      )
    ).rejects.toThrow('Too many outstanding highlight tip intents')
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        5
      )
    })
  })

  it('does not count expired or linked intents against the outstanding cap', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)
    const asTipper = t.withIdentity({ subject: tipperId })
    const quotes: Array<{ intentId: Id<'highlightTipIntents'> }> = []
    for (const startOffset of [0, 20, 40, 60, 80]) {
      quotes.push(
        await asTipper.mutation(
          api.highlightTips.prepareHighlightTip,
          prepareArgs(articleId, startOffset)
        )
      )
    }
    await t.run(async (ctx) => {
      await ctx.db.patch(quotes[0]!.intentId, { expiresAt: Date.now() - 1 })
      const linkedTipId = await ctx.db.insert('highlightTips', {
        highlightId: 'legacy-linked-placeholder',
        articleId,
        tipperId,
        authorId: (await ctx.db.get(articleId))!.authorId,
        highlightText: 'placeholder',
        articleTitle: 'Hello',
        articleSlug: 'hello',
        amountUsd: 1,
        amountCents: 100,
        stellarTxId: 'linked-placeholder',
        stellarNetwork: 'TESTNET',
        stellarMemo: 'legacy-linked-placeholder',
        startOffset: 0,
        endOffset: 1,
        status: 'PENDING',
        createdAt: Date.now(),
        processedAt: Date.now(),
        updatedAt: Date.now(),
      })
      await ctx.db.patch(quotes[1]!.intentId, { tipId: linkedTipId })
    })

    await expect(
      asTipper.mutation(
        api.highlightTips.prepareHighlightTip,
        prepareArgs(articleId, 100)
      )
    ).resolves.toMatchObject({ intentId: expect.any(String) })
  })

  it('rejects invalid amounts, text, selection bounds, and source accounts without writing', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    for (const amountCents of [0, 10_001, 1.5, Number.NaN]) {
      await expect(
        asTipper.mutation(api.highlightTips.prepareHighlightTip, {
          ...prepareArgs(articleId),
          amountCents,
        })
      ).rejects.toThrow('Invalid tip amount')
    }
    for (const highlightText of ['', '   ', 'x'.repeat(5001)]) {
      await expect(
        asTipper.mutation(api.highlightTips.prepareHighlightTip, {
          ...prepareArgs(articleId),
          highlightText,
        })
      ).rejects.toThrow('Invalid highlight text')
    }
    const invalidBounds: Array<[number, number]> = [
      [-1, 4],
      [1.5, 4],
      [4, 4],
      [5, 4],
    ]
    for (const [startOffset, endOffset] of invalidBounds) {
      await expect(
        asTipper.mutation(api.highlightTips.prepareHighlightTip, {
          ...prepareArgs(articleId),
          startOffset,
          endOffset,
        })
      ).rejects.toThrow('Invalid highlight selection bounds')
    }
    await expect(
      asTipper.mutation(api.highlightTips.prepareHighlightTip, {
        ...prepareArgs(articleId),
        stellarSourceAccount: 'not-a-stellar-account',
      })
    ).rejects.toThrow('Invalid Stellar source account')

    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        0
      )
    })
  })

  it('requires authentication and a receiving wallet', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    await expect(
      t.mutation(api.highlightTips.prepareHighlightTip, prepareArgs(articleId))
    ).rejects.toThrow('Not authenticated')

    await t.run(async (ctx) => {
      await ctx.db.patch(authorId, { stellarAddress: undefined })
    })
    await expect(
      t
        .withIdentity({ subject: tipperId })
        .mutation(api.highlightTips.prepareHighlightTip, prepareArgs(articleId))
    ).rejects.toThrow('Author has not configured a receiving wallet')
  })

  it('rejects missing articles and authors with explicit errors', async () => {
    const missingArticleTest = convexTest(schema, modules)
    const missingArticle = await seed(missingArticleTest)
    await missingArticleTest.run(async (ctx) => {
      await ctx.db.delete(missingArticle.articleId)
    })
    await expect(
      missingArticleTest
        .withIdentity({ subject: missingArticle.tipperId })
        .mutation(
          api.highlightTips.prepareHighlightTip,
          prepareArgs(missingArticle.articleId)
        )
    ).rejects.toThrow('Article not found')

    const missingAuthorTest = convexTest(schema, modules)
    const missingAuthor = await seed(missingAuthorTest)
    await missingAuthorTest.run(async (ctx) => {
      await ctx.db.delete(missingAuthor.authorId)
    })
    await expect(
      missingAuthorTest
        .withIdentity({ subject: missingAuthor.tipperId })
        .mutation(
          api.highlightTips.prepareHighlightTip,
          prepareArgs(missingAuthor.articleId)
        )
    ).rejects.toThrow('Author not found')
  })
})

describe('submitHighlightTip', () => {
  it('creates one pending tip entirely from the intent plus receipt metadata', async () => {
    const t = convexTest(schema, modules)
    const { asTipper, quote, articleId, authorId } = await prepare(t)

    const tipId = await asTipper.mutation(
      api.highlightTips.submitHighlightTip,
      {
        intentId: quote.intentId,
        stellarTxId: 'tx-highlight-intent',
        stellarLedger: 123,
        stellarFeeCharged: '0.00001',
        contractTipId: 'contract-tip-1',
      }
    )

    const state = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      intent: await ctx.db.get(quote.intentId),
      article: await ctx.db.get(articleId),
      earnings: await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first(),
    }))
    expect(state.tip).toMatchObject({
      highlightTipIntentId: quote.intentId,
      highlightId: quote.highlightId,
      highlightText: 'authoritative passage',
      startOffset: 4,
      endOffset: 19,
      startContainerPath: '0.0',
      endContainerPath: '0.0',
      amountCents: 500,
      amountUsd: 5,
      message: 'This line stayed with me.',
      stellarTxId: 'tx-highlight-intent',
      stellarNetwork: 'TESTNET',
      stellarMemo: quote.highlightId,
      stellarLedger: 123,
      stellarFeeCharged: '0.00001',
      stellarSourceAccount: TIPPER_STELLAR_ADDRESS,
      stellarDestinationAccount: AUTHOR_STELLAR_ADDRESS,
      stellarAmountXlm: '20',
      contractTipId: 'contract-tip-1',
      expectedHighlightId: quote.highlightId,
      expectedArticleSymbol: quote.articleSymbol,
      expectedAmountStroops: '200000000',
      expectedContractId: TIPPING_CONTRACT_ID,
      expectedMinTime: quote.timeBounds.minTime,
      expectedMaxTime: quote.timeBounds.maxTime,
      status: 'PENDING',
    })
    expect(state.intent?.tipId).toBe(tipId)
    expect(state.article?.tipCount).toBe(0)
    expect(state.article?.totalTipsUsd).toBe(0)
    expect(state.earnings).toBeNull()
  })

  it('accepts an expired signed intent and makes retries idempotent', async () => {
    const t = convexTest(schema, modules)
    const { asTipper, quote } = await prepare(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(quote.intentId, { expiresAt: Date.now() - 1 })
    })
    const receipt = {
      intentId: quote.intentId,
      stellarTxId: 'tx-expired-highlight-intent',
    }

    const first = await asTipper.mutation(
      api.highlightTips.submitHighlightTip,
      receipt
    )
    const second = await asTipper.mutation(
      api.highlightTips.submitHighlightTip,
      receipt
    )
    expect(second).toBe(first)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTips').collect()).toHaveLength(1)
    })
  })

  it('rejects cross-user intent access and caller-scopes status and retry', async () => {
    const t = convexTest(schema, modules)
    const { asTipper, quote } = await prepare(t)
    const otherId = await t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('users', {
        email: 'other@x.test',
        username: 'other',
        createdAt: now,
        updatedAt: now,
      })
    })
    const asOther = t.withIdentity({ subject: otherId })

    await expect(
      asOther.mutation(api.highlightTips.submitHighlightTip, {
        intentId: quote.intentId,
        stellarTxId: 'tx-cross-user',
      })
    ).rejects.toThrow('Highlight tip intent not found')

    const tipId = await asTipper.mutation(
      api.highlightTips.submitHighlightTip,
      {
        intentId: quote.intentId,
        stellarTxId: 'tx-owned-highlight',
      }
    )
    await expect(
      asOther.query(api.highlightTips.getHighlightTipStatus, { tipId })
    ).rejects.toThrow('Highlight tip not found')
    await expect(
      asOther.mutation(api.highlightTips.retryHighlightTipVerification, {
        tipId,
      })
    ).rejects.toThrow('Highlight tip not found')
    await expect(
      asTipper.query(api.highlightTips.getHighlightTipStatus, { tipId })
    ).resolves.toMatchObject({ status: 'PENDING' })
  })

  it('rejects transaction hash reuse by a different intent', async () => {
    const t = convexTest(schema, modules)
    const { asTipper, quote, articleId } = await prepare(t)
    await asTipper.mutation(api.highlightTips.submitHighlightTip, {
      intentId: quote.intentId,
      stellarTxId: 'tx-reused-highlight',
    })
    const second = await asTipper.mutation(
      api.highlightTips.prepareHighlightTip,
      prepareArgs(articleId, 30)
    )

    await expect(
      asTipper.mutation(api.highlightTips.submitHighlightTip, {
        intentId: second.intentId,
        stellarTxId: 'tx-reused-highlight',
      })
    ).rejects.toThrow(
      'This Stellar transaction is already linked to a different tip.'
    )
  })
})
