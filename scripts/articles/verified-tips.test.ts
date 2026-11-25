/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  confirmedTipPatch,
  isVerifiedTip,
  UNVERIFIED_TIP_STATUS,
} from '../../convex/lib/verifiedTips'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type TestConvex = ReturnType<typeof newTest>

async function seed(t: TestConvex) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      createdAt: now,
      updatedAt: now,
    })
    const tipperId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await db.insert('articles', {
      slug: 'words',
      title: 'Words',
      content: { type: 'doc', content: [] },
      published: true,
      publishedAt: now,
      authorId,
      authorUsername: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    return { authorId, tipperId, articleId, now }
  })
}

type Seed = Awaited<ReturnType<typeof seed>>

async function insertArticleTip(
  t: TestConvex,
  ids: Seed,
  fields: { status: string; verifiedAt?: number; amountCents?: number }
) {
  const cents = fields.amountCents ?? 100
  return t.run(({ db }) =>
    db.insert('tips', {
      articleId: ids.articleId,
      tipperId: ids.tipperId,
      authorId: ids.authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: cents / 100,
      amountCents: cents,
      expectedAmountStroops: '20000000',
      stellarTxId: crypto.randomUUID(),
      status: fields.status,
      verifiedAt: fields.verifiedAt,
      createdAt: ids.now,
      updatedAt: ids.now,
    })
  )
}

async function insertPassageTip(
  t: TestConvex,
  ids: Seed,
  fields: { status: string; verifiedAt?: number }
) {
  return t.run(({ db }) =>
    db.insert('highlightTips', {
      highlightId: 'passage',
      articleId: ids.articleId,
      tipperId: ids.tipperId,
      authorId: ids.authorId,
      highlightText: 'Words',
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: 2,
      amountCents: 200,
      expectedAmountStroops: '40000000',
      stellarTxId: crypto.randomUUID(),
      stellarNetwork: 'TESTNET',
      stellarMemo: 'passage',
      startOffset: 0,
      endOffset: 5,
      status: fields.status,
      verifiedAt: fields.verifiedAt,
      createdAt: ids.now,
      processedAt: ids.now,
      updatedAt: ids.now,
    })
  )
}

test('confirmation requires a verification time', () => {
  expect(() => confirmedTipPatch(0)).toThrow(/verification time/)
  expect(() => confirmedTipPatch(Number.NaN)).toThrow(/verification time/)
  expect(confirmedTipPatch(123)).toMatchObject({
    status: 'CONFIRMED',
    verifiedAt: 123,
  })
  expect(isVerifiedTip({ status: 'CONFIRMED' })).toBe(false)
  expect(isVerifiedTip({ status: 'PENDING', verifiedAt: 1 })).toBe(false)
  expect(isVerifiedTip({ status: 'CONFIRMED', verifiedAt: 1 })).toBe(true)
})

test('server verification stamps verifiedAt on article tips', async () => {
  const t = newTest()
  const ids = await seed(t)
  const tipId = await insertArticleTip(t, ids, { status: 'PENDING' })
  await t.mutation(internal.articleTipVerify.confirmVerifiedArticleTip, {
    tipId,
  })
  const tip = await t.run(({ db }) => db.get(tipId))
  expect(tip?.status).toBe('CONFIRMED')
  expect(tip?.verifiedAt).toBeGreaterThan(0)
})

test('public and writer stats count verified tips only', async () => {
  const t = newTest()
  const ids = await seed(t)
  await insertArticleTip(t, ids, { status: 'CONFIRMED', verifiedAt: ids.now })
  await insertArticleTip(t, ids, { status: 'CONFIRMED', amountCents: 5000 })
  await insertArticleTip(t, ids, { status: 'PENDING' })
  await insertPassageTip(t, ids, { status: 'CONFIRMED', verifiedAt: ids.now })
  await insertPassageTip(t, ids, { status: 'CONFIRMED' })

  const stats = await t.query(api.tips.getArticleTipStats, {
    articleId: ids.articleId,
  })
  expect(stats).toEqual({ totalTips: 1, totalAmountUsd: 1, uniqueTippers: 1 })

  const tips = await t.query(api.tips.getArticleTips, {
    articleId: ids.articleId,
  })
  expect(tips).toHaveLength(1)

  const userStats = await t.query(api.users.getUserStats, {
    userId: ids.authorId,
  })
  expect(userStats).toMatchObject({ totalEarnings: 1, tipsReceivedCount: 1 })

  const passageStats = await t.query(api.highlightTips.getArticleStats, {
    articleId: ids.articleId,
  })
  expect(passageStats.totalTips).toBe(1)

  const heatmap = await t.query(api.highlightTips.getByArticle, {
    articleId: ids.articleId,
  })
  expect(heatmap).toEqual([
    expect.objectContaining({ tipCount: 1, totalAmountCents: 200 }),
  ])

  const author = t.withIdentity({ subject: `${ids.authorId}|session` })
  const received = await author.query(api.tips.getUserReceivedTips, {})
  expect(received).toHaveLength(1)
  const summary = await author.query(api.tips.getMyEarningsSummary, {})
  // 2 XLM + 4 XLM verified, minus the 2.5% platform fee.
  expect(summary).toEqual({
    network: 'TESTNET',
    tipCount: 2,
    writerShareStroops: '58500000',
    estimatedUsd: 2.925,
  })
})

test('earnings summary is private to the signed-in writer', async () => {
  const t = newTest()
  expect(await t.query(api.tips.getMyEarningsSummary, {})).toBeNull()
})

test('legacy cleanup is a dry run by default', async () => {
  const t = newTest()
  const ids = await seed(t)
  const legacyId = await insertArticleTip(t, ids, { status: 'CONFIRMED' })
  await insertArticleTip(t, ids, { status: 'CONFIRMED', verifiedAt: ids.now })
  await t.run(async ({ db }) => {
    await db.patch(ids.articleId, { tipCount: 2, totalTipsUsd: 2 })
    await db.patch(ids.authorId, { tipsReceivedCount: 2 })
    await db.patch(ids.tipperId, { tipsSentCount: 2 })
  })

  const report = await t.mutation(internal.legacyTipCleanup.run, {
    table: 'tips',
  })
  expect(report.apply).toBe(false)
  expect(report.unverified.map((row) => row.id)).toEqual([legacyId])
  expect(report.counterChanges).toEqual(
    expect.arrayContaining([
      { id: ids.articleId, field: 'articles.tipCount', before: 2, after: 1 },
      {
        id: ids.articleId,
        field: 'articles.totalTipsUsd',
        before: 2,
        after: 1,
      },
      {
        id: ids.authorId,
        field: 'users.tipsReceivedCount',
        before: 2,
        after: 1,
      },
      { id: ids.tipperId, field: 'users.tipsSentCount', before: 2, after: 1 },
    ])
  )

  const unchanged = await t.run(async ({ db }) => ({
    tip: await db.get(legacyId),
    article: await db.get(ids.articleId),
  }))
  expect(unchanged.tip?.status).toBe('CONFIRMED')
  expect(unchanged.article?.tipCount).toBe(2)
})

test('legacy cleanup applies once and is idempotent', async () => {
  const t = newTest()
  const ids = await seed(t)
  const legacyArticleTip = await insertArticleTip(t, ids, {
    status: 'CONFIRMED',
  })
  const legacyPassageTip = await insertPassageTip(t, ids, {
    status: 'CONFIRMED',
  })
  await insertArticleTip(t, ids, { status: 'CONFIRMED', verifiedAt: ids.now })
  await t.run(async ({ db }) => {
    await db.patch(ids.articleId, { tipCount: 3, totalTipsUsd: 4 })
    await db.patch(ids.authorId, { tipsReceivedCount: 3 })
  })

  for (const table of ['tips', 'highlightTips'] as const) {
    const report = await t.mutation(internal.legacyTipCleanup.run, {
      table,
      apply: true,
    })
    expect(report.unverified).toHaveLength(1)
    expect(report.isDone).toBe(true)
  }

  const after = await t.run(async ({ db }) => ({
    articleTip: await db.get(legacyArticleTip),
    passageTip: await db.get(legacyPassageTip),
    article: await db.get(ids.articleId),
    author: await db.get(ids.authorId),
  }))
  expect(after.articleTip?.status).toBe(UNVERIFIED_TIP_STATUS)
  expect(after.articleTip?.failureReason).toMatch(/before server verification/)
  expect(after.passageTip?.status).toBe(UNVERIFIED_TIP_STATUS)
  expect(after.article).toMatchObject({ tipCount: 1, totalTipsUsd: 1 })
  expect(after.author?.tipsReceivedCount).toBe(1)

  for (const table of ['tips', 'highlightTips'] as const) {
    const again = await t.mutation(internal.legacyTipCleanup.run, {
      table,
      apply: true,
    })
    expect(again.unverified).toEqual([])
    expect(again.counterChanges).toEqual([])
  }

  // The tipper still sees the row in their own history.
  const tipper = t.withIdentity({ subject: `${ids.tipperId}|session` })
  const sent = await tipper.query(api.tips.getUserSentTips, {})
  expect(
    sent.find((tip) => tip._id === (legacyArticleTip as Id<'tips'>))?.status
  ).toBe(UNVERIFIED_TIP_STATUS)
})

test('earnings backfill ignores unverified confirmed tips', async () => {
  const t = newTest()
  const ids = await seed(t)
  await insertArticleTip(t, ids, { status: 'CONFIRMED' })
  const page = await t.query(
    internal.authorEarningsBackfill.confirmedTipsPage,
    {
      authorId: ids.authorId,
      table: 'tips',
      cursor: null,
    }
  )
  expect(page.tips).toEqual([])
})
