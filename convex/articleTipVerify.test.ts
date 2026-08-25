/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const emptyDoc = { type: 'doc', content: [] }
const TIPPER = Keypair.random().publicKey()
const AUTHOR = Keypair.random().publicKey()
const OTHER_ACCOUNT = Keypair.random().publicKey()
const CONTRACT_ID = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const ROTATED_CONTRACT_ID =
  'CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = CONTRACT_ID
})

function buildArticleEnvelope(args: {
  articleSymbol: string
  amountStroops: bigint
  source?: string
  author?: string
  contractId?: string
  functionName?: string
  timeBounds?: { minTime: string; maxTime: string }
}) {
  const source = args.source ?? TIPPER
  const account = new Account(source, '1')
  const contract = new Contract(args.contractId ?? CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: args.timeBounds ?? {
      minTime: '1',
      maxTime: '2000000000',
    },
  })
    .addOperation(
      contract.call(
        args.functionName ?? 'tip_article',
        nativeToScVal(source, { type: 'address' }),
        nativeToScVal(args.articleSymbol, { type: 'symbol' }),
        nativeToScVal(args.author ?? AUTHOR, { type: 'address' }),
        nativeToScVal(args.amountStroops, { type: 'i128' })
      )
    )
    .build()
  return tx.toEnvelope().toXDR('base64')
}

function buildArticleBatchEnvelope(args: {
  articleSymbol: string
  amountStroops: bigint
  timeBounds: { minTime: string; maxTime: string }
}) {
  const account = new Account(TIPPER, '1')
  const contract = new Contract(CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: args.timeBounds,
  })
    .addOperation(
      contract.call(
        'batch_tip',
        nativeToScVal(TIPPER, { type: 'address' }),
        nativeToScVal(
          [
            {
              article_id: args.articleSymbol,
              author: AUTHOR,
              amount: args.amountStroops,
            },
          ],
          {
            type: {
              article_id: ['symbol', 'symbol'],
              author: ['symbol', 'address'],
              amount: ['symbol', 'i128'],
            },
          }
        )
      )
    )
    .build()
  return tx.toEnvelope().toXDR('base64')
}

async function createPendingTip(t: ReturnType<typeof convexTest>) {
  const seeded = await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'tipper@x.test',
      username: 'tipper',
      stellarAddress: TIPPER,
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      stellarAddress: AUTHOR,
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await ctx.db.insert('articles', {
      slug: 'trusted-tip',
      title: 'Trusted Tip',
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
    await ctx.db.insert('xlmPriceCache', {
      priceUsd: 0.25,
      source: 'TestOracle',
      fetchedAt: now,
    })
    return { tipperId, authorId, articleId }
  })

  const asTipper = t.withIdentity({ subject: seeded.tipperId })
  const intent = await asTipper.mutation(api.tips.prepareArticleTip, {
    articleId: seeded.articleId,
    amountCents: 500,
    stellarSourceAccount: TIPPER,
  })
  const tipId = await asTipper.mutation(api.tips.submitArticleTip, {
    intentId: intent.intentId,
    stellarTxId: 'trusted-article-tx',
  })
  return { ...seeded, tipId, intent }
}

function stubHorizon(body: unknown, status = 200) {
  const responseBody =
    typeof body === 'object' && body !== null
      ? { created_at: new Date().toISOString(), ...body }
      : body
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    }))
  )
}

describe('verifyArticleTip', () => {
  it('confirms and credits a matching on-chain article tip exactly once', async () => {
    const t = convexTest(schema, modules)
    const { tipId, intent, articleId, authorId, tipperId } =
      await createPendingTip(t)
    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      envelope_xdr: buildArticleEnvelope({
        articleSymbol: intent.articleSymbol,
        amountStroops: BigInt(intent.amountStroops),
        timeBounds: intent.timeBounds,
      }),
    })

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })
    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      const article = await ctx.db.get(articleId)
      const author = await ctx.db.get(authorId)
      const tipper = await ctx.db.get(tipperId)
      const earnings = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .first()

      expect(tip).toMatchObject({
        status: 'CONFIRMED',
        stellarLedger: 1234,
        verifiedAt: expect.any(Number),
      })
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(5)
      expect(author?.tipsReceivedCount).toBe(1)
      expect(tipper?.tipsSentCount).toBe(1)
      expect(earnings?.totalEarnedCents).toBe(500)
      expect(earnings?.availableBalanceCents).toBe(500)
    })
  })

  it('verifies against the contract stored on the intent after config rotation', async () => {
    process.env.TIPPING_CONTRACT_ID = CONTRACT_ID
    const t = convexTest(schema, modules)
    const { tipId, intent } = await createPendingTip(t)
    process.env.TIPPING_CONTRACT_ID = ROTATED_CONTRACT_ID
    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      envelope_xdr: buildArticleEnvelope({
        articleSymbol: intent.articleSymbol,
        amountStroops: BigInt(intent.amountStroops),
        timeBounds: intent.timeBounds,
      }),
    })

    try {
      await t.action(internal.articleTipVerify.verifyArticleTip, {
        tipId,
        attempt: 1,
      })
    } finally {
      process.env.TIPPING_CONTRACT_ID = CONTRACT_ID
    }

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'CONFIRMED',
        verifiedAt: expect.any(Number),
      })
    })
  })

  it('fails without credit when the on-chain amount differs by one stroop', async () => {
    const t = convexTest(schema, modules)
    const { tipId, intent, articleId, authorId } = await createPendingTip(t)
    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      envelope_xdr: buildArticleEnvelope({
        articleSymbol: intent.articleSymbol,
        amountStroops: BigInt(intent.amountStroops) - BigInt(1),
        timeBounds: intent.timeBounds,
      }),
    })

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'amount_mismatch',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
      expect(
        await ctx.db
          .query('authorEarnings')
          .withIndex('by_user', (q) => q.eq('userId', authorId))
          .first()
      ).toBeNull()
    })
  })

  it.each([
    {
      name: 'source',
      expectedReason: 'source_mismatch',
      envelope: { source: OTHER_ACCOUNT },
    },
    {
      name: 'contract',
      expectedReason: 'contract_mismatch',
      envelope: { contractId: ROTATED_CONTRACT_ID },
    },
    {
      name: 'function',
      expectedReason: 'function_mismatch',
      envelope: { functionName: 'unexpected_tip_function' },
    },
    {
      name: 'article',
      expectedReason: 'article_mismatch',
      envelope: { articleSymbol: 'another123' },
    },
    {
      name: 'author',
      expectedReason: 'author_mismatch',
      envelope: { author: OTHER_ACCOUNT },
    },
    {
      name: 'intent time bounds',
      expectedReason: 'timebounds_mismatch',
      envelope: {
        timeBounds: { minTime: '999999999', maxTime: '2000000001' },
      },
    },
  ])(
    'fails without credit when the on-chain $name differs',
    async ({ expectedReason, envelope }) => {
      const t = convexTest(schema, modules)
      const { tipId, intent, articleId, authorId } = await createPendingTip(t)
      const source = envelope.source ?? TIPPER
      stubHorizon({
        successful: true,
        source_account: source,
        ledger: 1234,
        envelope_xdr: buildArticleEnvelope({
          articleSymbol: intent.articleSymbol,
          amountStroops: BigInt(intent.amountStroops),
          timeBounds: intent.timeBounds,
          ...envelope,
        }),
      })

      await t.action(internal.articleTipVerify.verifyArticleTip, {
        tipId,
        attempt: 1,
      })

      await t.run(async (ctx) => {
        expect(await ctx.db.get(tipId)).toMatchObject({
          status: 'FAILED',
          failureReason: expectedReason,
        })
        expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
        expect(
          await ctx.db
            .query('authorEarnings')
            .withIndex('by_user', (q) => q.eq('userId', authorId))
            .first()
        ).toBeNull()
      })
    }
  )

  it('rejects a matching old transaction created before the payment intent', async () => {
    const t = convexTest(schema, modules)
    const { tipId, intent, articleId } = await createPendingTip(t)
    const tip = await t.run(async (ctx) => await ctx.db.get(tipId))
    const preparedIntent = await t.run(async (ctx) =>
      tip?.articleTipIntentId ? await ctx.db.get(tip.articleTipIntentId) : null
    )
    if (!preparedIntent) throw new Error('Expected prepared article tip intent')

    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      created_at: new Date(
        preparedIntent.createdAt - 5 * 60 * 1000
      ).toISOString(),
      envelope_xdr: buildArticleEnvelope({
        articleSymbol: intent.articleSymbol,
        amountStroops: BigInt(intent.amountStroops),
        timeBounds: intent.timeBounds,
      }),
    })

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'transaction_before_intent',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it('rejects a batch article tip when its item belongs to another article', async () => {
    const t = convexTest(schema, modules)
    const { tipId, intent, articleId } = await createPendingTip(t)
    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      envelope_xdr: buildArticleBatchEnvelope({
        articleSymbol: 'another123',
        amountStroops: BigInt(intent.amountStroops),
        timeBounds: intent.timeBounds,
      }),
    })

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'article_mismatch',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it('rejects a batch article tip whose item exceeds the prepared exact amount', async () => {
    const t = convexTest(schema, modules)
    const { tipId, intent, articleId } = await createPendingTip(t)
    stubHorizon({
      successful: true,
      source_account: TIPPER,
      ledger: 1234,
      envelope_xdr: buildArticleBatchEnvelope({
        articleSymbol: intent.articleSymbol,
        amountStroops: BigInt(intent.amountStroops) + BigInt(1),
        timeBounds: intent.timeBounds,
      }),
    })

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'amount_mismatch',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it('keeps the tip pending after the transient retry budget is exhausted', async () => {
    const t = convexTest(schema, modules)
    const { tipId } = await createPendingTip(t)
    stubHorizon({}, 503)

    await t.action(internal.articleTipVerify.verifyArticleTip, {
      tipId,
      attempt: 3,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'PENDING',
        failureReason: 'verification_temporarily_unavailable',
      })
    })
  })
})

describe('article tip verification status', () => {
  it('lets only the tipper read the verification state', async () => {
    const t = convexTest(schema, modules)
    const { tipId, tipperId } = await createPendingTip(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    await expect(
      asTipper.query(api.tips.getArticleTipStatus, { tipId })
    ).resolves.toEqual({
      status: 'PENDING',
      failureReason: undefined,
      verifiedAt: undefined,
    })

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
      asOther.query(api.tips.getArticleTipStatus, { tipId })
    ).rejects.toThrow('Article tip not found')
  })

  it('clears a transient reason and reschedules verification without a new payment', async () => {
    const startedAt = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(startedAt)
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }))
    const t = convexTest(schema, modules)
    const { tipId, tipperId } = await createPendingTip(t)
    await t.mutation(
      internal.articleTipVerify.markArticleTipTemporarilyUnavailable,
      { tipId }
    )
    const before = await t.run(async (ctx) => await ctx.db.get(tipId))
    const asTipper = t.withIdentity({ subject: tipperId })

    await asTipper.mutation(api.tips.retryArticleTipVerification, { tipId })

    const after = await t.run(async (ctx) => await ctx.db.get(tipId))
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()

    expect(after?.status).toBe('PENDING')
    expect(after?.failureReason).toBeUndefined()
    expect(after?.stellarTxId).toBe(before?.stellarTxId)
    expect(after?.articleTipIntentId).toBe(before?.articleTipIntentId)
  })

  it('coalesces owner retry requests during the cooldown window', async () => {
    const startedAt = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(startedAt)
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }))
    const t = convexTest(schema, modules)
    const { tipId, tipperId } = await createPendingTip(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    await asTipper.mutation(api.tips.retryArticleTipVerification, { tipId })
    vi.setSystemTime(startedAt + 1)
    await asTipper.mutation(api.tips.retryArticleTipVerification, { tipId })

    const tip = await t.run(async (ctx) => await ctx.db.get(tipId))
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()

    expect(tip).toMatchObject({ verificationRequestedAt: startedAt })
  })
})
