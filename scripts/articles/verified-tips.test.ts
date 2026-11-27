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
import { formatXlmFromStroops } from '../../lib/copy/network-status'

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
  expect(stats).toMatchObject({
    totalTips: 1,
    totalAmountUsd: 1,
    uniqueTippers: 1,
  })

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
    earnedStroops: '58500000',
    estimatedUsd: 2.925,
    earnedBaseUnits: {},
    v2TipCount: 0,
    complete: true,
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

const convexSources = import.meta.glob('../../convex/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

test('only confirmedTipPatch writes the CONFIRMED status', () => {
  const offenders = Object.entries(convexSources)
    .filter(([path]) => !path.includes('/_generated/'))
    .filter(([path]) => !path.endsWith('/lib/verifiedTips.ts'))
    .filter(([, source]) =>
      /status:\s*['"]CONFIRMED['"]|status:\s*CONFIRMED_TIP_STATUS/.test(source)
    )
    .map(([path]) => path)
  expect(offenders).toEqual([])
})

test('legacy cleanup is internal and never scheduled', () => {
  const cleanup = convexSources['../../convex/legacyTipCleanup.ts']
  expect(cleanup).toMatch(/export const run = internalMutation\(/)
  const others = Object.entries(convexSources).filter(
    ([path]) =>
      !path.includes('/_generated/') && !path.endsWith('/legacyTipCleanup.ts')
  )
  for (const [path, source] of others) {
    expect(source, path).not.toMatch(/legacyTipCleanup/)
  }
})

test('the retired client confirmation path is rejected', async () => {
  const t = newTest()
  const ids = await seed(t)
  const tipper = t.withIdentity({ subject: `${ids.tipperId}|session` })
  await expect(
    tipper.mutation(api.tips.sendTip, {
      articleId: ids.articleId,
      amountUsd: 1,
      stellarTxId: 'a'.repeat(64),
    })
  ).rejects.toThrow(/disabled/)
  const rows = await t.run(({ db }) => db.query('tips').collect())
  expect(rows).toEqual([])
})

test('the legacy highlight confirm entrypoint never confirms', async () => {
  const t = newTest()
  const ids = await seed(t)
  const tipId = await insertPassageTip(t, ids, { status: 'PENDING' })
  await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
    id: tipId,
  })
  const tip = await t.run(({ db }) => db.get(tipId))
  expect(tip?.status).toBe('FAILED')
  expect(tip?.verifiedAt).toBeUndefined()
})

test('server verification stamps verifiedAt on highlight tips', async () => {
  const t = newTest()
  const ids = await seed(t)
  const tipId = await t.run(async ({ db }) => {
    const snapshot = {
      articleId: ids.articleId,
      tipperId: ids.tipperId,
      authorId: ids.authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      highlightText: 'Words',
      startOffset: 0,
      endOffset: 5,
      amountUsd: 2,
      amountCents: 200,
      quotePriceUsd: 0.5,
      quoteSource: 'test',
      quoteFetchedAt: ids.now,
    }
    const expected = {
      expectedSourceAccount: 'G'.padEnd(56, 'A'),
      expectedDestinationAccount: 'G'.padEnd(56, 'B'),
      expectedHighlightId: 'passage',
      expectedArticleSymbol: 'words',
      expectedAmountStroops: '40000000',
      expectedContractId: 'C'.padEnd(56, 'C'),
      expectedFunction: 'tip_highlight_direct',
      expectedMinTime: '0',
      expectedMaxTime: String(Math.floor(ids.now / 1000) + 300),
    }
    const intentId = await db.insert('highlightTipIntents', {
      ...snapshot,
      ...expected,
      expectedStellarNetwork: 'TESTNET',
      expiresAt: ids.now + 60_000,
      createdAt: ids.now,
      updatedAt: ids.now,
    })
    const id = await db.insert('highlightTips', {
      ...snapshot,
      ...expected,
      highlightId: 'passage',
      highlightTipIntentId: intentId,
      stellarTxId: 'f'.repeat(64),
      stellarNetwork: 'TESTNET',
      stellarMemo: 'passage',
      stellarSourceAccount: expected.expectedSourceAccount,
      stellarDestinationAccount: expected.expectedDestinationAccount,
      stellarAmountXlm: '4',
      status: 'PENDING',
      createdAt: ids.now,
      processedAt: ids.now,
      updatedAt: ids.now,
    })
    await db.patch(intentId, { tipId: id })
    return id
  })

  await t.mutation(internal.stellarVerify.confirmVerifiedHighlightTip, {
    id: tipId,
    stellarLedger: 42,
  })
  const after = await t.run(async ({ db }) => ({
    tip: await db.get(tipId),
    article: await db.get(ids.articleId),
  }))
  expect(after.tip?.status).toBe('CONFIRMED')
  expect(after.tip?.verifiedAt).toBeGreaterThan(0)
  expect(after.article?.tipCount).toBe(1)
})

test('fraud reversal leaves unverified rows and counters alone', async () => {
  const t = newTest()
  const ids = await seed(t)
  const tipId = await insertArticleTip(t, ids, {
    status: UNVERIFIED_TIP_STATUS,
  })
  await t.run(({ db }) => db.patch(ids.articleId, { tipCount: 3 }))
  await t.mutation(internal.tips.markArticleTipFraudulent, {
    tipId,
    reason: 'test',
  })
  const after = await t.run(async ({ db }) => ({
    tip: await db.get(tipId),
    article: await db.get(ids.articleId),
  }))
  expect(after.tip?.status).toBe(UNVERIFIED_TIP_STATUS)
  expect(after.article?.tipCount).toBe(3)
})

test('NFT minting threshold uses verified tips, not the counter', async () => {
  const t = newTest()
  const ids = await seed(t)
  await insertArticleTip(t, ids, { status: 'CONFIRMED', amountCents: 5000 })
  await insertArticleTip(t, ids, { status: UNVERIFIED_TIP_STATUS })
  await insertArticleTip(t, ids, {
    status: 'CONFIRMED',
    verifiedAt: ids.now,
    amountCents: 300,
  })
  await t.run(({ db }) =>
    db.patch(ids.articleId, { tipCount: 3, totalTipsUsd: 54 })
  )
  const threshold = await t.query(api.nfts.checkMintingThreshold, {
    articleId: ids.articleId,
  })
  expect(threshold).toMatchObject({ eligible: false, totalTips: 3 })
  const nft = await t.query(api.nfts.getNFTByArticle, {
    articleId: ids.articleId,
  })
  expect(nft).toMatchObject({ totalTips: 300 })
})

test('legacy cleanup pages through every row and a second pass is empty', async () => {
  const t = newTest()
  const ids = await seed(t)
  const legacy = []
  for (let i = 0; i < 3; i++) {
    legacy.push(await insertArticleTip(t, ids, { status: 'CONFIRMED' }))
    await insertArticleTip(t, ids, {
      status: 'CONFIRMED',
      verifiedAt: ids.now,
    })
  }
  await t.run(async ({ db }) => {
    await db.patch(ids.articleId, { tipCount: 6, totalTipsUsd: 6 })
    await db.patch(ids.authorId, { tipsReceivedCount: 6 })
    await db.patch(ids.tipperId, { tipsSentCount: 6 })
  })

  const pass = async () => {
    const found: string[] = []
    let cursor: string | null = null
    let pages = 0
    for (;;) {
      const report: {
        unverified: { id: string }[]
        isDone: boolean
        continueCursor: string
      } = await t.mutation(internal.legacyTipCleanup.run, {
        table: 'tips',
        apply: true,
        pageSize: 1,
        cursor,
      })
      found.push(...report.unverified.map((row) => row.id))
      pages += 1
      if (report.isDone) break
      cursor = report.continueCursor
      expect(pages).toBeLessThan(20)
    }
    return found
  }

  expect((await pass()).sort()).toEqual([...legacy].sort())
  expect(await pass()).toEqual([])

  const after = await t.run(async ({ db }) => ({
    article: await db.get(ids.articleId),
    author: await db.get(ids.authorId),
    tipper: await db.get(ids.tipperId),
  }))
  expect(after.article).toMatchObject({ tipCount: 3, totalTipsUsd: 3 })
  expect(after.author?.tipsReceivedCount).toBe(3)
  expect(after.tipper?.tipsSentCount).toBe(3)

  const nan = await t.mutation(internal.legacyTipCleanup.run, {
    table: 'tips',
    pageSize: Number.NaN,
  })
  expect(nan.isDone).toBe(true)
})

test('XLM amounts format exactly or rounded for display', () => {
  expect(formatXlmFromStroops('58500000')).toBe('5.85 XLM')
  expect(formatXlmFromStroops('9750000')).toBe('0.975 XLM')
  expect(formatXlmFromStroops('9750000', 2)).toBe('0.98 XLM')
  expect(formatXlmFromStroops('1234567891234567', 2)).toBe('123,456,789.12 XLM')
  expect(formatXlmFromStroops('19999999', 2)).toBe('2 XLM')
  expect(formatXlmFromStroops('0', 2)).toBe('0 XLM')
  expect(formatXlmFromStroops('-5', 2)).toBe('0 XLM')
})
