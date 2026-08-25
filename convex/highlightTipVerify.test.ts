/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
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
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const TIPPER = Keypair.random().publicKey()
const AUTHOR = Keypair.random().publicKey()
const ROTATED_ACCOUNT = Keypair.random().publicKey()
const CONTRACT_ID = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const ROTATED_CONTRACT_ID =
  'CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S'
const TX_PRIMARY = 'a'.repeat(64)
const ARTICLE_TEXT = 'This authoritative passage rewards the exact writer.'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = CONTRACT_ID
})

beforeEach(() => {
  process.env.TIPPING_CONTRACT_ID = CONTRACT_ID
  process.env.STELLAR_NETWORK = 'TESTNET'
  delete process.env.HORIZON_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function buildHighlightEnvelope(args: {
  highlightId: string
  articleSymbol: string
  amountStroops: bigint
  source?: string
  author?: string
  contractId?: string
  functionName?: string
  extraArgument?: boolean
  timeBounds: { minTime: string; maxTime: string }
}) {
  const source = args.source ?? TIPPER
  const account = new Account(source, '1')
  const contract = new Contract(args.contractId ?? CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: args.timeBounds,
  })
    .addOperation(
      contract.call(
        args.functionName ?? 'tip_highlight_direct',
        nativeToScVal(source, { type: 'address' }),
        nativeToScVal(args.highlightId, { type: 'string' }),
        nativeToScVal(args.articleSymbol, { type: 'symbol' }),
        nativeToScVal(args.author ?? AUTHOR, { type: 'address' }),
        nativeToScVal(args.amountStroops, { type: 'i128' }),
        ...(args.extraArgument
          ? [nativeToScVal('unexpected', { type: 'string' })]
          : [])
      )
    )
    .build()
  return tx.toEnvelope().toXDR('base64')
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'tipper@x.test',
      username: 'tipper',
      name: 'Tipper Name',
      avatar: 'tipper-avatar',
      stellarAddress: TIPPER,
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      name: 'Author Name',
      avatar: 'author-avatar',
      stellarAddress: AUTHOR,
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: ARTICLE_TEXT }],
        },
      ],
    }
    const articleId = await ctx.db.insert('articles', {
      slug: 'exact-highlight-tip',
      title: 'Exact Highlight Tip',
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
    const otherArticleId = await ctx.db.insert('articles', {
      slug: 'other-article',
      title: 'Other Article',
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
    return { tipperId, authorId, articleId, otherArticleId }
  })
}

async function createPendingTip(
  t: ReturnType<typeof convexTest>,
  txId = TX_PRIMARY
) {
  const seeded = await seed(t)
  const asTipper = t.withIdentity({ subject: seeded.tipperId })
  const quote = await asTipper.mutation(api.highlightTips.prepareHighlightTip, {
    articleId: seeded.articleId,
    highlightText: 'authoritative passage',
    startOffset: 5,
    endOffset: 26,
    startContainerPath: 'text.6',
    endContainerPath: 'text.27',
    amountCents: 500,
    message: 'This exact passage mattered.',
    stellarSourceAccount: TIPPER,
  })
  const tipId = await asTipper.mutation(api.highlightTips.submitHighlightTip, {
    intentId: quote.intentId,
    stellarTxId: txId,
  })
  return { ...seeded, asTipper, quote, tipId }
}

function stubHorizon(
  body: Record<string, unknown>,
  status = 200,
  onUrl?: (url: string) => void
) {
  vi.stubGlobal('fetch', async (url: string) => {
    onUrl?.(url)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ created_at: new Date().toISOString(), ...body }),
    }
  })
}

function stubMatchingHorizon(
  quote: Awaited<ReturnType<typeof createPendingTip>>['quote'],
  overrides: Partial<Parameters<typeof buildHighlightEnvelope>[0]> = {},
  responseOverrides: Record<string, unknown> = {}
) {
  const envelopeArgs = {
    highlightId: quote.highlightId,
    articleSymbol: quote.articleSymbol,
    amountStroops: BigInt(quote.amountStroops),
    timeBounds: quote.timeBounds,
    ...overrides,
  }
  stubHorizon({
    successful: true,
    source_account: envelopeArgs.source ?? TIPPER,
    ledger: 1234,
    envelope_xdr: buildHighlightEnvelope(envelopeArgs),
    ...responseOverrides,
  })
}

describe('exact highlight tip verification', () => {
  it('keeps a delayed verifier fallback instead of checking before broadcast can settle', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const state = await createPendingTip(t)
    stubMatchingHorizon(state.quote)

    await vi.advanceTimersByTimeAsync(2_000)
    await t.finishInProgressScheduledFunctions()
    await t.run(async (ctx) => {
      expect(await ctx.db.get(state.tipId)).toMatchObject({ status: 'PENDING' })
    })

    await vi.advanceTimersByTimeAsync(8_000)
    await t.finishInProgressScheduledFunctions()
    await t.run(async (ctx) => {
      expect(await ctx.db.get(state.tipId)).toMatchObject({
        status: 'CONFIRMED',
      })
    })
  })

  it('does not let the legacy confirmer settle an intent-backed pending tip', async () => {
    const t = convexTest(schema, modules)
    const { tipId, articleId, authorId, tipperId } = await createPendingTip(t)

    await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
      id: tipId,
      stellarLedger: 1234,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip).toMatchObject({ status: 'PENDING' })
      expect(tip?.verifiedAt).toBeUndefined()
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
      expect((await ctx.db.get(articleId))?.totalTipsUsd).toBe(0)
      expect((await ctx.db.get(tipperId))?.tipsSentCount).toBe(0)
      expect((await ctx.db.get(authorId))?.tipsReceivedCount).toBe(0)
      expect(
        await ctx.db
          .query('authorEarnings')
          .withIndex('by_user', (q) => q.eq('userId', authorId))
          .first()
      ).toBeNull()
    })
  })

  it('confirms and credits the exact intent-backed transaction once', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, articleId, authorId, tipperId } =
      await createPendingTip(t)
    stubMatchingHorizon(quote)

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })
    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
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
        .unique()

      expect(tip).toMatchObject({
        status: 'CONFIRMED',
        stellarLedger: 1234,
        verifiedAt: expect.any(Number),
      })
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(5)
      expect(tipper?.tipsSentCount).toBe(1)
      expect(author?.tipsReceivedCount).toBe(1)
      expect(earnings?.totalEarnedCents).toBe(500)
      expect(earnings?.availableBalanceCents).toBe(500)
      expect(earnings?.tipCount).toBe(1)
      expect(earnings?.topArticles).toEqual([
        {
          articleId,
          title: 'Exact Highlight Tip',
          earnings: 5,
          tipCount: 1,
        },
      ])
    })
  })

  it('adds exact highlight credit to an existing author earnings row once', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, articleId, authorId } = await createPendingTip(t)
    await t.run(async (ctx) => {
      const now = Date.now()
      const date = new Date(now)
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, '0')}`
      await ctx.db.insert('authorEarnings', {
        userId: authorId,
        totalEarnedUsd: 2,
        totalEarnedCents: 200,
        availableBalanceUsd: 2,
        availableBalanceCents: 200,
        pendingBalanceUsd: 0,
        pendingBalanceCents: 0,
        withdrawnUsd: 0,
        withdrawnCents: 0,
        tipCount: 1,
        lastTipAt: now,
        monthlyEarnings: { [monthKey]: 2 },
        topArticles: [
          {
            articleId,
            title: 'Exact Highlight Tip',
            earnings: 2,
            tipCount: 1,
          },
        ],
        createdAt: now,
        updatedAt: now,
      })
    })
    stubMatchingHorizon(quote)

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })
    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const earnings = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .unique()
      expect(earnings?.totalEarnedCents).toBe(700)
      expect(earnings?.availableBalanceCents).toBe(700)
      expect(earnings?.tipCount).toBe(2)
      expect(Object.values(earnings?.monthlyEarnings ?? {})).toEqual([7])
      expect(earnings?.topArticles).toEqual([
        {
          articleId,
          title: 'Exact Highlight Tip',
          earnings: 7,
          tipCount: 2,
        },
      ])
    })
  })

  it.each([
    {
      name: 'source',
      reason: 'source_mismatch',
      envelope: { source: ROTATED_ACCOUNT },
    },
    {
      name: 'highlight',
      reason: 'highlight_mismatch',
      envelope: { highlightId: 'wrong-highlight' },
    },
    {
      name: 'article',
      reason: 'article_mismatch',
      envelope: { articleSymbol: 'wrong12345' },
    },
    {
      name: 'author',
      reason: 'author_mismatch',
      envelope: { author: ROTATED_ACCOUNT },
    },
    {
      name: 'contract',
      reason: 'contract_mismatch',
      envelope: { contractId: ROTATED_CONTRACT_ID },
    },
    {
      name: 'unrecognized function',
      reason: 'function_mismatch',
      envelope: { functionName: 'unexpected_tip_function' },
    },
    {
      name: 'alternate allowed highlight function',
      reason: 'function_mismatch',
      envelope: { functionName: 'tip_highlight_with_arweave' },
    },
    {
      name: 'argument count',
      reason: 'malformed_response',
      envelope: { extraArgument: true },
    },
    {
      name: 'intent time bounds',
      reason: 'timebounds_mismatch',
      envelope: {
        timeBounds: { minTime: '1', maxTime: '2000000000' },
      },
    },
  ])(
    'fails without credit when the on-chain $name differs',
    async ({ reason, envelope }) => {
      const t = convexTest(schema, modules)
      const { tipId, quote, articleId, authorId } = await createPendingTip(t)
      stubMatchingHorizon(quote, envelope)

      await t.action(internal.stellarVerify.verifyHighlightTip, {
        highlightTipId: tipId,
        attempt: 1,
      })

      await t.run(async (ctx) => {
        expect(await ctx.db.get(tipId)).toMatchObject({
          status: 'FAILED',
          failureReason: reason,
        })
        expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
        expect(
          await ctx.db
            .query('authorEarnings')
            .withIndex('by_user', (q) => q.eq('userId', authorId))
            .unique()
        ).toBeNull()
      })
    }
  )

  it.each([-1, 1])(
    'rejects an on-chain amount that differs by %i stroop',
    async (delta) => {
      const t = convexTest(schema, modules)
      const { tipId, quote, articleId } = await createPendingTip(t)
      stubMatchingHorizon(quote, {
        highlightId: quote.highlightId,
        articleSymbol: quote.articleSymbol,
        amountStroops: BigInt(quote.amountStroops) + BigInt(delta),
        timeBounds: quote.timeBounds,
      })

      await t.action(internal.stellarVerify.verifyHighlightTip, {
        highlightTipId: tipId,
        attempt: 1,
      })

      await t.run(async (ctx) => {
        expect(await ctx.db.get(tipId)).toMatchObject({
          status: 'FAILED',
          failureReason: 'amount_mismatch',
        })
        expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
      })
    }
  )

  it('uses the frozen author even if the author rotates their wallet before verification', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, authorId, articleId } = await createPendingTip(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(authorId, { stellarAddress: ROTATED_ACCOUNT })
    })
    stubMatchingHorizon(quote, { author: ROTATED_ACCOUNT })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'author_mismatch',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it('rejects a matching transaction created before the intent window', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, articleId } = await createPendingTip(t)
    const intent = await t.run(async (ctx) => await ctx.db.get(quote.intentId))
    if (!intent) throw new Error('Expected highlight tip intent')
    stubMatchingHorizon(
      quote,
      {
        highlightId: quote.highlightId,
        articleSymbol: quote.articleSymbol,
        amountStroops: BigInt(quote.amountStroops),
        timeBounds: quote.timeBounds,
      },
      {
        created_at: new Date(intent.createdAt - 5 * 60 * 1000).toISOString(),
      }
    )

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
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

  it('rejects a matching transaction created after the intent window', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, articleId } = await createPendingTip(t)
    const intent = await t.run(async (ctx) => await ctx.db.get(quote.intentId))
    if (!intent) throw new Error('Expected highlight tip intent')
    stubMatchingHorizon(
      quote,
      {},
      {
        created_at: new Date(intent.expiresAt + 5 * 60 * 1000).toISOString(),
      }
    )

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'transaction_after_intent',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it('uses the intent network endpoint and frozen contract after config rotation', async () => {
    process.env.STELLAR_NETWORK = 'MAINNET'
    const t = convexTest(schema, modules)
    const { tipId, quote } = await createPendingTip(t)
    process.env.STELLAR_NETWORK = 'TESTNET'
    process.env.TIPPING_CONTRACT_ID = ROTATED_CONTRACT_ID
    process.env.HORIZON_URL = 'https://untrusted-horizon.example'
    let requestedUrl = ''
    const envelopeXdr = buildHighlightEnvelope({
      highlightId: quote.highlightId,
      articleSymbol: quote.articleSymbol,
      amountStroops: BigInt(quote.amountStroops),
      timeBounds: quote.timeBounds,
    })
    stubHorizon(
      {
        successful: true,
        source_account: TIPPER,
        ledger: 1234,
        envelope_xdr: envelopeXdr,
      },
      200,
      (url) => {
        if (url.includes('/transactions/')) requestedUrl = url
      }
    )

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    expect(requestedUrl).toMatch(
      /^https:\/\/horizon\.stellar\.org\/transactions\//
    )
    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'CONFIRMED',
        verifiedAt: expect.any(Number),
      })
    })
  })

  it('fails closed when any copied immutable snapshot field diverges from its linked intent', async () => {
    type SnapshotPatch = (
      tip: Doc<'highlightTips'>,
      ids: {
        tipperId: Id<'users'>
        authorId: Id<'users'>
        otherArticleId: Id<'articles'>
      }
    ) => Record<string, unknown>
    const mutations: Array<{ name: string; patch: SnapshotPatch }> = [
      {
        name: 'articleId',
        patch: (_tip, ids) => ({ articleId: ids.otherArticleId }),
      },
      {
        name: 'tipperId',
        patch: (_tip, ids) => ({ tipperId: ids.authorId }),
      },
      {
        name: 'authorId',
        patch: (_tip, ids) => ({ authorId: ids.tipperId }),
      },
      { name: 'articleTitle', patch: () => ({ articleTitle: 'Tampered' }) },
      { name: 'articleSlug', patch: () => ({ articleSlug: 'tampered' }) },
      { name: 'tipperName', patch: () => ({ tipperName: 'Tampered' }) },
      {
        name: 'tipperAvatar',
        patch: () => ({ tipperAvatar: 'tampered' }),
      },
      { name: 'authorName', patch: () => ({ authorName: 'Tampered' }) },
      {
        name: 'authorAvatar',
        patch: () => ({ authorAvatar: 'tampered' }),
      },
      { name: 'highlightText', patch: () => ({ highlightText: 'tampered' }) },
      {
        name: 'startOffset',
        patch: (tip) => ({ startOffset: tip.startOffset + 1 }),
      },
      {
        name: 'endOffset',
        patch: (tip) => ({ endOffset: tip.endOffset + 1 }),
      },
      {
        name: 'startContainerPath',
        patch: () => ({ startContainerPath: '9.9' }),
      },
      {
        name: 'endContainerPath',
        patch: () => ({ endContainerPath: '9.9' }),
      },
      {
        name: 'amountUsd',
        patch: (tip) => ({ amountUsd: tip.amountUsd + 1 }),
      },
      {
        name: 'amountCents',
        patch: (tip) => ({ amountCents: tip.amountCents + 1 }),
      },
      { name: 'message', patch: () => ({ message: 'tampered' }) },
      { name: 'highlightId', patch: () => ({ highlightId: 'tampered' }) },
      {
        name: 'stellarNetwork',
        patch: () => ({ stellarNetwork: 'MAINNET' }),
      },
      { name: 'stellarMemo', patch: () => ({ stellarMemo: 'tampered' }) },
      {
        name: 'stellarSourceAccount',
        patch: () => ({ stellarSourceAccount: ROTATED_ACCOUNT }),
      },
      {
        name: 'stellarDestinationAccount',
        patch: () => ({ stellarDestinationAccount: ROTATED_ACCOUNT }),
      },
      {
        name: 'stellarAmountXlm',
        patch: () => ({ stellarAmountXlm: '0.1' }),
      },
      {
        name: 'expectedSourceAccount',
        patch: () => ({ expectedSourceAccount: ROTATED_ACCOUNT }),
      },
      {
        name: 'expectedDestinationAccount',
        patch: () => ({ expectedDestinationAccount: ROTATED_ACCOUNT }),
      },
      {
        name: 'expectedHighlightId',
        patch: () => ({ expectedHighlightId: 'tampered' }),
      },
      {
        name: 'expectedArticleSymbol',
        patch: () => ({ expectedArticleSymbol: 'tampered' }),
      },
      {
        name: 'expectedAmountStroops',
        patch: () => ({ expectedAmountStroops: '1' }),
      },
      {
        name: 'expectedContractId',
        patch: () => ({ expectedContractId: ROTATED_CONTRACT_ID }),
      },
      {
        name: 'expectedFunction',
        patch: () => ({ expectedFunction: 'tip_highlight_with_arweave' }),
      },
      {
        name: 'expectedMinTime',
        patch: () => ({ expectedMinTime: '1' }),
      },
      {
        name: 'expectedMaxTime',
        patch: () => ({ expectedMaxTime: '1' }),
      },
      {
        name: 'quotePriceUsd',
        patch: (tip) => ({ quotePriceUsd: (tip.quotePriceUsd ?? 0) + 1 }),
      },
      { name: 'quoteSource', patch: () => ({ quoteSource: 'Tampered' }) },
      {
        name: 'quoteFetchedAt',
        patch: (tip) => ({
          quoteFetchedAt: (tip.quoteFetchedAt ?? 0) + 1,
        }),
      },
    ]

    for (const mutation of mutations) {
      const t = convexTest(schema, modules)
      const state = await createPendingTip(t)
      await t.run(async (ctx) => {
        const tip = await ctx.db.get(state.tipId)
        if (!tip) throw new Error('Expected pending highlight tip')
        await ctx.db.patch(state.tipId, mutation.patch(tip, state) as never)
      })
      stubMatchingHorizon(state.quote)

      await t.action(internal.stellarVerify.verifyHighlightTip, {
        highlightTipId: state.tipId,
        attempt: 1,
      })

      await t.run(async (ctx) => {
        expect(await ctx.db.get(state.tipId), mutation.name).toMatchObject({
          status: 'FAILED',
          failureReason: 'verification_expectation_mismatch',
        })
      })
    }
  })

  it.each(['missing intent', 'broken reverse link'])(
    'fails closed when the linked intent has a %s',
    async (condition) => {
      const t = convexTest(schema, modules)
      const { tipId, quote, articleId } = await createPendingTip(t)
      await t.run(async (ctx) => {
        if (condition === 'missing intent') {
          await ctx.db.delete(quote.intentId)
        } else {
          await ctx.db.patch(quote.intentId, { tipId: undefined })
        }
      })
      stubMatchingHorizon(quote)

      await t.action(internal.stellarVerify.verifyHighlightTip, {
        highlightTipId: tipId,
        attempt: 1,
      })

      await t.run(async (ctx) => {
        expect(await ctx.db.get(tipId)).toMatchObject({
          status: 'FAILED',
          failureReason:
            condition === 'missing intent'
              ? 'missing_verification_expectation'
              : 'verification_expectation_mismatch',
        })
        expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
      })
    }
  )

  it('rejects a transaction hash already present on another highlight tip row', async () => {
    const t = convexTest(schema, modules)
    const { tipId, quote, articleId } = await createPendingTip(t)
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      if (!tip) throw new Error('Expected pending highlight tip')
      const { _id, _creationTime, ...clone } = tip
      void _id
      void _creationTime
      await ctx.db.insert('highlightTips', {
        ...clone,
        stellarTxId: tip.stellarTxId.toUpperCase(),
        highlightTipIntentId: undefined,
        verifiedAt: undefined,
        status: 'CONFIRMED',
        createdAt: tip.createdAt - 1,
        updatedAt: tip.updatedAt - 1,
      })
    })
    stubMatchingHorizon(quote)

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(tipId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'transaction_hash_reused',
      })
      expect((await ctx.db.get(articleId))?.tipCount).toBe(0)
    })
  })

  it.each([408, 429, 503])(
    'keeps the tip pending after the transient retry budget is exhausted for HTTP %i',
    async (status) => {
      const t = convexTest(schema, modules)
      const { tipId } = await createPendingTip(t)
      stubHorizon({}, status)

      await t.action(internal.stellarVerify.verifyHighlightTip, {
        highlightTipId: tipId,
        attempt: 3,
      })

      await t.run(async (ctx) => {
        const tip = await ctx.db.get(tipId)
        expect(tip).toMatchObject({
          status: 'PENDING',
          failureReason: 'verification_temporarily_unavailable',
        })
        expect(tip?.verifiedAt).toBeUndefined()
      })
    }
  )
})
