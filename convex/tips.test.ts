/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
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

  it('allows when elapsed is exactly TIP_COOLDOWN_MS (boundary)', async () => {
    // Pins the >= comparison in checkTipCooldown so a future refactor to >
    // (off-by-one in the wrong direction) is caught immediately. We bypass
    // the public mutation here to control `now` and the previous tip's
    // createdAt to the millisecond — Date.now() inside the mutation would
    // drift between insert and check, masking the exact boundary.
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)

    const tipTime = 1_700_000_000_000
    await t.run(async (ctx) => {
      await ctx.db.insert('tips', {
        articleId,
        articleTitle: 'X',
        articleSlug: 'x',
        tipperId,
        authorId: tipperId, // self-ref ok for cooldown logic; not enforced here
        amountUsd: 1,
        amountCents: 100,
        status: 'CONFIRMED',
        createdAt: tipTime,
        updatedAt: tipTime,
      })
    })

    const { TIP_COOLDOWN_MS } = await import('./lib/constants')
    const { checkTipCooldown } = await import('./lib/rateLimit')

    // Exactly TIP_COOLDOWN_MS elapsed → allowed.
    const atBoundary = await t.run(async (ctx) =>
      checkTipCooldown(ctx, tipperId, tipTime + TIP_COOLDOWN_MS)
    )
    expect(atBoundary).toEqual({ allowed: true })

    // One ms before the boundary → still blocked. Pins the other side of >=.
    const justBefore = await t.run(async (ctx) =>
      checkTipCooldown(ctx, tipperId, tipTime + TIP_COOLDOWN_MS - 1)
    )
    expect(justBefore.allowed).toBe(false)
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

  it('rejects when the same stellarTxId is reused for a different article', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)

    // Seed a second article so we can attempt the cross-article reuse.
    const otherArticleId: Id<'articles'> = await t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('articles', {
        slug: 'goodbye',
        title: 'Goodbye',
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: (await ctx.db.get(articleId))!.authorId,
        authorUsername: 'author',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    const asTipper = t.withIdentity({ subject: tipperId })

    await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-cross-article',
    })

    // Backdate the first tip so the cooldown does not block the second call.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('tips')
        .withIndex('by_stellar_tx', (q) =>
          q.eq('stellarTxId', 'tx-cross-article')
        )
        .first()
      if (row) {
        await ctx.db.patch(row._id, { createdAt: row.createdAt - 60_000 })
      }
    })

    await expect(
      asTipper.mutation(api.tips.sendTip, {
        articleId: otherArticleId,
        amountUsd: 1,
        stellarTxId: 'tx-cross-article',
      })
    ).rejects.toThrow(/already linked to a different tip/i)
  })

  it('rejects when the same stellarTxId is reused by a different tipper', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)

    // Seed a second tipper.
    const otherTipperId = await t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('users', {
        email: 'tipper2@x.test',
        username: 'tipper2',
        tipsSentCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-cross-user',
    })

    const asOther = t.withIdentity({ subject: otherTipperId })
    await expect(
      asOther.mutation(api.tips.sendTip, {
        articleId,
        amountUsd: 1,
        stellarTxId: 'tx-cross-user',
      })
    ).rejects.toThrow(/already linked to a different tip/i)
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

describe('markArticleTipFraudulent', () => {
  // Send a tip, directly invoke confirmTip to credit counters, and return ids
  // for assertions. Returns baseline (pre-tip) counter values so tests can
  // verify the reversal returns to that exact state.
  async function seedConfirmedTip(
    t: ReturnType<typeof convexTest>,
    opts: { amountUsd?: number; stellarTxId?: string } = {}
  ) {
    const { tipperId, authorId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: opts.amountUsd ?? 1,
      stellarTxId: opts.stellarTxId ?? 'tx-fraud-fixture',
    })
    await t.mutation(internal.tips.confirmTip, { tipId })
    return { tipperId, authorId, articleId, tipId }
  }

  it('reverses every counter confirmTip applied and flips status to FRAUDULENT', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId, tipId } = await seedConfirmedTip(t)

    // Pre-state: counters bumped
    const pre = await t.run(async (ctx) => ({
      tipper: await ctx.db.get(tipperId),
      author: await ctx.db.get(authorId),
      article: await ctx.db.get(articleId),
      earnings: await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first(),
    }))
    expect(pre.tipper?.tipsSentCount).toBe(1)
    expect(pre.author?.tipsReceivedCount).toBe(1)
    expect(pre.article?.tipCount).toBe(1)
    expect(pre.article?.totalTipsUsd).toBe(1)
    expect(pre.earnings?.tipCount).toBe(1)
    expect(pre.earnings?.totalEarnedCents).toBe(100)
    expect(pre.earnings?.availableBalanceCents).toBe(100)

    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'contract_mismatch',
    })

    const post = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      tipper: await ctx.db.get(tipperId),
      author: await ctx.db.get(authorId),
      article: await ctx.db.get(articleId),
      earnings: await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first(),
    }))
    expect(post.tip?.status).toBe('FRAUDULENT')
    expect(post.tip?.failureReason).toBe('contract_mismatch')
    expect(post.tipper?.tipsSentCount).toBe(0)
    expect(post.author?.tipsReceivedCount).toBe(0)
    expect(post.article?.tipCount).toBe(0)
    expect(post.article?.totalTipsUsd).toBe(0)
    expect(post.earnings?.tipCount).toBe(0)
    expect(post.earnings?.totalEarnedCents).toBe(0)
    expect(post.earnings?.availableBalanceCents).toBe(0)
  })

  it('is idempotent: a second call on a FRAUDULENT tip does not double-reverse', async () => {
    const t = convexTest(schema, modules)
    const { authorId, articleId, tipId } = await seedConfirmedTip(t)

    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'first_reason',
    })
    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'second_reason',
    })

    const post = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      article: await ctx.db.get(articleId),
      earnings: await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first(),
    }))
    // failureReason from the FIRST call — second call no-oped
    expect(post.tip?.failureReason).toBe('first_reason')
    // Counters at 0, not -1 (no double decrement)
    expect(post.article?.tipCount).toBe(0)
    expect(post.earnings?.totalEarnedCents).toBe(0)
  })

  it('does nothing on a PENDING tip (guard prevents negative counter math)', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seedTipperAndArticle(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    // Send tip but DO NOT run confirmTip — tip stays PENDING with no counter
    // credits applied.
    const tipId = await asTipper.mutation(api.tips.sendTip, {
      articleId,
      amountUsd: 1,
      stellarTxId: 'tx-still-pending',
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'should_be_skipped',
    })

    const { tip, article } = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      article: await ctx.db.get(articleId),
    }))
    expect(tip?.status).toBe('PENDING')
    expect(tip?.failureReason).toBeUndefined()
    // Article counters untouched (still at seed state)
    expect(article?.tipCount).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      '[reconcileTips] markArticleTipFraudulent skipped: tip not CONFIRMED',
      expect.objectContaining({ currentStatus: 'PENDING' })
    )
    warnSpy.mockRestore()
  })

  it('deletes the monthlyEarnings key when its value hits zero', async () => {
    const t = convexTest(schema, modules)
    const { authorId, tipId } = await seedConfirmedTip(t)

    // Before reverse: exactly one month key with the tip's amount
    const preKeys = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first()
      return Object.keys((e?.monthlyEarnings ?? {}) as Record<string, number>)
    })
    expect(preKeys).toHaveLength(1)

    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'amount_mismatch',
    })

    const postKeys = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first()
      return Object.keys((e?.monthlyEarnings ?? {}) as Record<string, number>)
    })
    expect(postKeys).toHaveLength(0)
  })

  it('removes a topArticles entry when both earnings and tipCount hit zero', async () => {
    const t = convexTest(schema, modules)
    const { authorId, articleId, tipId } = await seedConfirmedTip(t)

    const preTopArticles = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first()
      return e?.topArticles ?? []
    })
    expect(preTopArticles).toHaveLength(1)
    expect(preTopArticles[0]?.articleId).toBe(articleId)

    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId,
      reason: 'function_mismatch',
    })

    const postTopArticles = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first()
      return e?.topArticles ?? []
    })
    expect(postTopArticles).toHaveLength(0)
  })
})
