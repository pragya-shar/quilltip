/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'
import { writerShareCents } from '../../convex/lib/authorEarnings'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type TestConvex = ReturnType<typeof newTest>

test('writer share matches the contract split', () => {
  expect(writerShareCents(100)).toBe(97.5)
  expect(writerShareCents(100, '20000000')).toBe(97.5)
  // The contract rounds the 2.5% fee down, so the writer keeps the remainder.
  expect(writerShareCents(1, '420001')).toBe(0.975)
  expect(writerShareCents(40, 'not-a-number')).toBe(39)
})

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
      authorId,
      authorUsername: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    const tipId = await db.insert('tips', {
      articleId,
      tipperId,
      authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: 1,
      amountCents: 100,
      expectedAmountStroops: '20000000',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    })
    return { authorId, articleId, tipId }
  })
}

async function earningsFor(
  t: TestConvex,
  authorId: Awaited<ReturnType<typeof seed>>['authorId']
) {
  return t.run(({ db }) =>
    db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', authorId))
      .first()
  )
}

test('backfill rebuilds gross earnings rows from confirmed tips', async () => {
  const t = newTest()
  const { authorId, articleId, tipId } = await seed(t)
  await t.run(async ({ db }) => {
    const now = Date.now()
    await db.patch(tipId, { status: 'CONFIRMED', verifiedAt: now })
    const tipperId = (await db.get(tipId))!.tipperId
    // A confirmed tip whose USD amount could not be trusted stays out of earnings.
    await db.insert('highlightTips', {
      highlightId: 'flagged',
      articleId,
      tipperId,
      authorId,
      highlightText: 'Words',
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: 50,
      amountCents: 5000,
      stellarTxId: 'tx-flagged',
      stellarNetwork: 'TESTNET',
      stellarMemo: 'flagged',
      startOffset: 0,
      endOffset: 5,
      status: 'CONFIRMED',
      amountUsdSuspicious: true,
      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })
    await db.insert('authorEarnings', {
      userId: authorId,
      totalEarnedUsd: 1,
      totalEarnedCents: 100,
      availableBalanceUsd: 1,
      availableBalanceCents: 100,
      pendingBalanceUsd: 0,
      pendingBalanceCents: 0,
      withdrawnUsd: 0,
      withdrawnCents: 0,
      tipCount: 1,
      lastTipAt: now,
      topArticles: [{ articleId, title: 'Words', earnings: 1, tipCount: 1 }],
      createdAt: now,
      updatedAt: now,
    })
  })

  const dryRun = await t.action(internal.authorEarningsBackfill.run, {
    dryRun: true,
  })
  expect(dryRun).toEqual({
    dryRun: true,
    rows: 1,
    changedRows: 1,
    skippedRows: 0,
    beforeTotalUsd: 1,
    afterTotalUsd: 0.975,
  })
  expect(await earningsFor(t, authorId)).toMatchObject({
    totalEarnedCents: 100,
  })

  await t.action(internal.authorEarningsBackfill.run, { dryRun: false })
  expect(await earningsFor(t, authorId)).toMatchObject({
    totalEarnedCents: 97.5,
    availableBalanceCents: 97.5,
    tipCount: 1,
    topArticles: [{ articleId, earnings: 0.975, tipCount: 1 }],
  })

  const again = await t.action(internal.authorEarningsBackfill.run, {
    dryRun: true,
  })
  expect(again.changedRows).toBe(0)
})
