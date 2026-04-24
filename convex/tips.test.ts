/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

// Valid testnet-format Stellar address (G + 55 base32 chars)
const VALID_STELLAR_ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV'.padEnd(56, 'A')

async function seedTipperAndArticle(t: ReturnType<typeof convexTest>) {
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
    const articleId: Id<'articles'> = await ctx.db.insert('articles', {
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

async function seedAuthorWithBalance(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const userId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorEarnings', {
      userId,
      totalEarnedUsd: 50,
      totalEarnedCents: 5000,
      availableBalanceUsd: 50,
      availableBalanceCents: 5000,
      pendingBalanceUsd: 0,
      pendingBalanceCents: 0,
      withdrawnUsd: 0,
      withdrawnCents: 0,
      tipCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    return { userId }
  })
}

describe('withdrawEarnings', () => {
  it('rejects NaN amount', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: NaN,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })

  it('rejects Infinity amount', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: Infinity,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })

  it('still rejects zero and negative amounts', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: 0,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: -5,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })
})

describe('canTip pre-flight query', () => {
  it('returns allowed=true for an unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.tips.canTip, {})
    expect(result).toEqual({ allowed: true })
  })

  it('returns allowed=true when the user has never tipped', async () => {
    const t = convexTest(schema, modules)
    const { tipperId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })
    const result = await asTipper.query(api.tips.canTip, {})
    expect(result).toEqual({ allowed: true })
  })

  it('returns allowed=false with a positive waitSec when inside the cooldown', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-canTip-inside-cooldown',
    })

    const result = await asTipper.query(api.tips.canTip, {})
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.waitSec).toBeGreaterThan(0)
      expect(result.waitSec).toBeLessThanOrEqual(10)
    }
  })

  it('returns allowed=true once the cooldown has elapsed', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const tipId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-canTip-elapsed',
    })
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      if (tip) {
        await ctx.db.patch(tipId, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const result = await asTipper.query(api.tips.canTip, {})
    expect(result).toEqual({ allowed: true })
  })
})

describe('sendTip cooldown', () => {
  it('rejects a second tip within the cooldown window', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-reject-cooldown-first',
    })

    await expect(
      asTipper.mutation(api.tips.sendTip, {
        articleId,
        amountUsd: 1,
        stellarTxId: 'tx-reject-cooldown-second',
      })
    ).rejects.toThrow(/wait .* before tipping again/i)
  })

  it('allows a second tip once the cooldown has elapsed', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const firstId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-elapsed-first',
    })
    // Backdate the first tip so the cooldown is no longer active.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(firstId)
      if (tip) {
        await ctx.db.patch(firstId, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const secondId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-elapsed-second',
    })
    expect(secondId).not.toBe(firstId)
  })

  it('treats a recent highlight tip as triggering the cooldown', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seedTipperAndArticle(t)

    // Seed a very recent highlight tip from the same user.
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('highlightTips', {
        highlightId: 'hash-x',
        articleId,
        tipperId,
        authorId,
        highlightText: 'sample',
        articleTitle: 'Hello',
        articleSlug: 'hello',
        amountUsd: 0.01,
        amountCents: 1,
        stellarTxId: 'tx-x',
        stellarNetwork: 'TESTNET',
        stellarMemo: 'hash-x',
        startOffset: 0,
        endOffset: 1,
        status: 'CONFIRMED',
        createdAt: now,
        processedAt: now,
        updatedAt: now,
      })
    })

    const asTipper = t.withIdentity({ subject: tipperId })
    await expect(
      asTipper.mutation(api.tips.sendTip, {
        articleId,
        amountUsd: 1,
        stellarTxId: 'tx-highlight-cooldown-crossover',
      })
    ).rejects.toThrow(/wait .* before tipping again/i)
  })
})

describe('sendTip', () => {
  it('persists all Stellar metadata on the inserted tip row', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const tipId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 0.5,
      stellarTxId: 'tx-persistence-fixture',
      stellarNetwork: 'TESTNET',
      stellarLedger: 12345678,
      stellarFeeCharged: '0.0001000',
      stellarSourceAccount: VALID_STELLAR_ADDRESS,
      stellarDestinationAccount: VALID_STELLAR_ADDRESS,
      stellarAmountXlm: '0.5000000',
      contractTipId: 'contract-tip-42',
      platformFee: 125_000,
      authorShare: 4_875_000,
    })

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip).toBeTruthy()
    if (!tip) return
    expect(tip.stellarTxId).toBe('tx-persistence-fixture')
    expect(tip.stellarNetwork).toBe('TESTNET')
    expect(tip.stellarLedger).toBe(12345678)
    expect(tip.stellarFeeCharged).toBe('0.0001000')
    expect(tip.stellarSourceAccount).toBe(VALID_STELLAR_ADDRESS)
    expect(tip.stellarDestinationAccount).toBe(VALID_STELLAR_ADDRESS)
    expect(tip.stellarAmountXlm).toBe('0.5000000')
    expect(tip.contractTipId).toBe('contract-tip-42')
    expect(tip.platformFee).toBe(125_000)
    expect(tip.authorShare).toBe(4_875_000)
    expect(tip.status).toBe('PENDING')
  })

  it('dedups concurrent retries sharing the same stellarTxId', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const firstId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-dedup-same',
    })

    const secondId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-dedup-same',
    })

    expect(secondId).toBe(firstId)

    const rowsForTxId = await t.run(async (ctx) =>
      ctx.db
        .query('tips')
        .withIndex('by_stellar_tx', (q) => q.eq('stellarTxId', 'tx-dedup-same'))
        .collect()
    )
    expect(rowsForTxId).toHaveLength(1)
  })

  it('does not dedup when stellarTxId is the empty sentinel', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    const firstId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: '',
    })

    // Backdate the first tip so the cooldown does not block the second call.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(firstId)
      if (tip) {
        await ctx.db.patch(firstId, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const secondId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: '',
    })

    expect(secondId).not.toBe(firstId)
  })

  it('rejects unauthenticated callers', async () => {
    const t = convexTest(schema, modules)
    const { articleId } = await seedTipperAndArticle(t)

    await expect(
      t.mutation(api.tips.sendTip, {
        articleId,
        amountUsd: 1,
        stellarTxId: 'tx-unauth',
      })
    ).rejects.toThrow(/not authenticated/i)
  })
})
