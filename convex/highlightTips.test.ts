/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const ARTICLE_TEXT = 'some highlighted text'
const articleContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: ARTICLE_TEXT }],
    },
  ],
}
const TIPPER_STELLAR = Keypair.random().publicKey()
const AUTHOR_STELLAR = Keypair.random().publicKey()
const OTHER_STELLAR = Keypair.random().publicKey()
const TIPPING_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = TIPPING_CONTRACT_ID
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'tipper@x.test',
      username: 'tipper',
      stellarAddress: TIPPER_STELLAR,
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      stellarAddress: AUTHOR_STELLAR,
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await ctx.db.insert('articles', {
      slug: 'hello',
      title: 'Hello',
      content: articleContent,
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
    await ctx.db.insert('xlmPriceCache', {
      priceUsd: 0.25,
      source: 'TestOracle',
      fetchedAt: now,
    })
    return { tipperId, authorId, articleId }
  })
}

function legacyCreateArgs(articleId: Id<'articles'>, stellarTxId: string) {
  return {
    highlightId: '856e15955152b6e33aa0f72fca51',
    articleId,
    highlightText: ARTICLE_TEXT,
    startOffset: 0,
    endOffset: ARTICLE_TEXT.length,
    startContainerPath: 'text.1',
    endContainerPath: `text.${ARTICLE_TEXT.length + 1}`,
    amountCents: 100,
    stellarTxId,
    stellarMemo: '856e15955152b6e33aa0f72fca51',
    stellarNetwork: 'TESTNET',
    stellarSourceAccount: TIPPER_STELLAR,
    stellarDestinationAccount: AUTHOR_STELLAR,
    stellarAmountXlm: '4',
  }
}

async function insertLegacyHighlightTip(
  t: ReturnType<typeof convexTest>,
  ids: Awaited<ReturnType<typeof seed>>,
  args: {
    status: 'PENDING' | 'CONFIRMED'
    stellarTxId: string
    createdAt?: number
  }
) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    return await ctx.db.insert('highlightTips', {
      highlightId: 'hash-abc',
      articleId: ids.articleId,
      tipperId: ids.tipperId,
      authorId: ids.authorId,
      highlightText: 'some highlighted text',
      articleTitle: 'Hello',
      articleSlug: 'hello',
      amountUsd: 1,
      amountCents: 100,
      stellarTxId: args.stellarTxId,
      stellarNetwork: 'TESTNET',
      stellarMemo: 'hash-abc',
      stellarSourceAccount: TIPPER_STELLAR,
      stellarDestinationAccount: AUTHOR_STELLAR,
      stellarAmountXlm: '1',
      startOffset: 0,
      endOffset: 10,
      status: args.status,
      createdAt: args.createdAt ?? now,
      processedAt: now,
      updatedAt: now,
    })
  })
}

async function expectNoCredit(
  t: ReturnType<typeof convexTest>,
  ids: Awaited<ReturnType<typeof seed>>
) {
  await t.run(async (ctx) => {
    expect((await ctx.db.get(ids.articleId))?.tipCount).toBe(0)
    expect((await ctx.db.get(ids.articleId))?.totalTipsUsd).toBe(0)
    expect((await ctx.db.get(ids.tipperId))?.tipsSentCount).toBe(0)
    expect((await ctx.db.get(ids.authorId))?.tipsReceivedCount).toBe(0)
    expect(await ctx.db.query('authorEarnings').collect()).toEqual([])
  })
}

describe('legacy highlight tip cutover', () => {
  it('registers an already-broadcast old-client receipt with server-owned expectations', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const tipId = await t
      .withIdentity({ subject: ids.tipperId })
      .mutation(api.highlightTips.create, {
        ...legacyCreateArgs(ids.articleId, '1'.repeat(64)),
        amountCents: 10_000,
      })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip).toMatchObject({
        highlightId: '856e15955152b6e33aa0f72fca51',
        highlightText: ARTICLE_TEXT,
        startOffset: 0,
        endOffset: ARTICLE_TEXT.length,
        amountCents: 100,
        stellarSourceAccount: TIPPER_STELLAR,
        stellarDestinationAccount: AUTHOR_STELLAR,
        stellarAmountXlm: '4',
        status: 'PENDING',
        highlightTipIntentId: expect.any(String),
      })
      const intent = tip?.highlightTipIntentId
        ? await ctx.db.get(tip.highlightTipIntentId)
        : null
      expect(intent).toMatchObject({
        articleId: ids.articleId,
        tipperId: ids.tipperId,
        authorId: ids.authorId,
        amountCents: 100,
        expectedHighlightId: '856e15955152b6e33aa0f72fca51',
        expectedArticleSymbol: '2ede2c6a40',
        expectedAmountStroops: '40000000',
        expectedSourceAccount: TIPPER_STELLAR,
        expectedDestinationAccount: AUTHOR_STELLAR,
        expectedContractId: TIPPING_CONTRACT_ID,
        expectedFunction: 'tip_highlight_direct',
        legacyCompatibility: true,
        tipId,
      })
    })
    await expectNoCredit(t, ids)
  })

  it('preserves a minimum one-cent old-client receipt when the fallback quote rounds below one cent', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    await t.run(async (ctx) => {
      const cached = await ctx.db.query('xlmPriceCache').first()
      if (cached) await ctx.db.delete(cached._id)
    })

    const tipId = await t
      .withIdentity({ subject: ids.tipperId })
      .mutation(api.highlightTips.create, {
        ...legacyCreateArgs(ids.articleId, '5'.repeat(64)),
        amountCents: 1,
        stellarAmountXlm: '0.042',
      })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        amountCents: 1,
        amountUsd: 0.01,
        expectedAmountStroops: '420000',
        quoteSource: 'Fallback',
      })
    })
  })

  it.each([
    { name: 'unauthenticated caller', authenticated: false, patch: {} },
    {
      name: 'invalid transaction hash',
      authenticated: true,
      patch: { stellarTxId: 'not-a-hash' },
    },
    {
      name: 'invalid source account',
      authenticated: true,
      patch: { stellarSourceAccount: 'not-an-account' },
    },
    {
      name: 'amount below the contract minimum',
      authenticated: true,
      patch: { stellarAmountXlm: '0.0000001' },
    },
    {
      name: 'invalid requested cents',
      authenticated: true,
      patch: { amountCents: 0 },
    },
    {
      name: 'spoofed passage',
      authenticated: true,
      patch: { highlightText: 'not the stored passage' },
    },
    {
      name: 'spoofed memo',
      authenticated: true,
      patch: { stellarMemo: 'spoofed-highlight' },
    },
    {
      name: 'wrong destination account',
      authenticated: true,
      patch: { stellarDestinationAccount: OTHER_STELLAR },
    },
    {
      name: 'wrong Stellar network',
      authenticated: true,
      patch: { stellarNetwork: 'MAINNET' },
    },
  ])('rejects a $name without creating payment state', async (testCase) => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const caller = testCase.authenticated
      ? t.withIdentity({ subject: ids.tipperId })
      : t

    await expect(
      caller.mutation(api.highlightTips.create, {
        ...legacyCreateArgs(ids.articleId, '6'.repeat(64)),
        ...testCase.patch,
      })
    ).rejects.toThrow()

    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toEqual([])
      expect(await ctx.db.query('highlightTips').collect()).toEqual([])
    })
    await expectNoCredit(t, ids)
  })

  it('returns the same compatibility row for a same-owner transaction retry', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const asTipper = t.withIdentity({ subject: ids.tipperId })
    const args = legacyCreateArgs(ids.articleId, '7'.repeat(64))

    const first = await asTipper.mutation(api.highlightTips.create, args)
    const second = await asTipper.mutation(api.highlightTips.create, args)

    expect(second).toBe(first)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        1
      )
      expect(await ctx.db.query('highlightTips').collect()).toHaveLength(1)
    })
    await expectNoCredit(t, ids)
  })

  it('rejects cross-owner transaction reuse without creating a second row', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const asTipper = t.withIdentity({ subject: ids.tipperId })
    const args = legacyCreateArgs(ids.articleId, '8'.repeat(64))
    await asTipper.mutation(api.highlightTips.create, args)
    const otherId = await t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('users', {
        email: 'other@x.test',
        username: 'other',
        createdAt: now,
        updatedAt: now,
      })
    })

    await expect(
      t
        .withIdentity({ subject: otherId })
        .mutation(api.highlightTips.create, args)
    ).rejects.toThrow(
      'This Stellar transaction is already linked to a different tip.'
    )
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        1
      )
      expect(await ctx.db.query('highlightTips').collect()).toHaveLength(1)
    })
    await expectNoCredit(t, ids)
  })

  it('enforces the payment cooldown before creating a second compatibility row', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const asTipper = t.withIdentity({ subject: ids.tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      legacyCreateArgs(ids.articleId, '9'.repeat(64))
    )

    await expect(
      asTipper.mutation(
        api.highlightTips.create,
        legacyCreateArgs(ids.articleId, 'a'.repeat(64))
      )
    ).rejects.toThrow(/Please wait \d+s before tipping again/)
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTipIntents').collect()).toHaveLength(
        1
      )
      expect(await ctx.db.query('highlightTips').collect()).toHaveLength(1)
    })
    await expectNoCredit(t, ids)
  })

  it('quarantines a legacy PENDING verifier call without Horizon or credit', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const tipId = await insertLegacyHighlightTip(t, ids, {
      status: 'PENDING',
      stellarTxId: '2'.repeat(64),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'legacy_pending_highlight_tip_quarantined',
      })
    })
    await expectNoCredit(t, ids)
  })

  it('quarantines the historical confirmer entrypoint without credit', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const tipId = await insertLegacyHighlightTip(t, ids, {
      status: 'PENDING',
      stellarTxId: '3'.repeat(64),
    })

    await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
      id: tipId,
      stellarLedger: 123,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'legacy_pending_highlight_tip_quarantined',
      })
    })
    await expectNoCredit(t, ids)
  })

  it('keeps already CONFIRMED legacy history readable and aggregate-only', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    const tipId = await insertLegacyHighlightTip(t, ids, {
      status: 'CONFIRMED',
      stellarTxId: '4'.repeat(64),
    })

    await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
      id: tipId,
      stellarLedger: 999,
    })
    await t.mutation(internal.stellarVerify.markHighlightTipFailed, {
      id: tipId,
      reason: 'late_failure',
    })

    const byHighlight = await t.query(api.highlightTips.getByHighlight, {
      highlightId: 'hash-abc',
    })
    const byArticle = await t.query(api.highlightTips.getByArticle, {
      articleId: ids.articleId,
    })
    const tipperHistory = await t
      .withIdentity({ subject: ids.tipperId })
      .query(api.highlightTips.getByTipper, {})
    const authorHistory = await t
      .withIdentity({ subject: ids.authorId })
      .query(api.highlightTips.getByAuthor, {})

    expect(byHighlight).toEqual({
      tipCount: 1,
      totalAmountCents: 100,
      totalAmountUsd: 1,
    })
    expect(byArticle).toEqual([
      expect.objectContaining({
        highlightId: 'hash-abc',
        totalAmountCents: 100,
        tipCount: 1,
      }),
    ])
    expect(tipperHistory).toEqual([
      expect.objectContaining({ _id: tipId, status: 'CONFIRMED' }),
    ])
    expect(authorHistory).toEqual([
      expect.objectContaining({ _id: tipId, status: 'CONFIRMED' }),
    ])

    const publicProjection = JSON.stringify({ byHighlight, byArticle })
    expect(publicProjection).not.toContain(TIPPER_STELLAR)
    expect(publicProjection).not.toContain(AUTHOR_STELLAR)
    expect(publicProjection).not.toContain('4'.repeat(64))
  })
})
