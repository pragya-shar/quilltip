/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const emptyDoc = { type: 'doc', content: [] }
const TIPPER_STELLAR = Keypair.random().publicKey()
const AUTHOR_STELLAR = Keypair.random().publicKey()
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

function legacyCreateArgs(articleId: Id<'articles'>, stellarTxId: string) {
  return {
    highlightId: 'hash-abc',
    articleId,
    highlightText: 'some highlighted text',
    startOffset: 0,
    endOffset: 10,
    startContainerPath: 'text.1',
    endContainerPath: 'text.11',
    amountCents: 100,
    stellarTxId,
    stellarMemo: 'hash-abc',
    stellarNetwork: 'TESTNET',
    stellarSourceAccount: TIPPER_STELLAR,
    stellarDestinationAccount: AUTHOR_STELLAR,
    stellarAmountXlm: '1',
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
  it('rejects new legacy writes', async () => {
    const t = convexTest(schema, modules)
    const ids = await seed(t)
    await expect(
      t
        .withIdentity({ subject: ids.tipperId })
        .mutation(
          api.highlightTips.create,
          legacyCreateArgs(ids.articleId, '1'.repeat(64))
        )
    ).rejects.toThrow(
      'Legacy highlight tip submission is no longer supported. Prepare and submit a highlight tip intent instead.'
    )
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTips').collect()).toEqual([])
    })
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
