/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

// Ephemeral keypairs — Keypair.random() produces StrKey-valid G... addresses
// that pass Address.fromScAddress() but have no on-chain existence. Tests
// build envelope XDRs, never submit or sign against a real network.
const TIPPER_KP = Keypair.random()
const AUTHOR_KP = Keypair.random()
const ATTACKER_KP = Keypair.random()
const TIPPER_STELLAR = TIPPER_KP.publicKey()
const AUTHOR_STELLAR = AUTHOR_KP.publicKey()
const ATTACKER_STELLAR = ATTACKER_KP.publicKey()
// Testnet tipping contract ID used in the README. Any real C... address works;
// the verifier just string-compares it against the envelope's contract.
const TIPPING_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const WRONG_CONTRACT_ID =
  'CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = TIPPING_CONTRACT_ID
})

function buildHighlightTipEnvelope(opts: {
  tipper: string
  author: string
  contractId: string
  amountStroops: bigint
  highlightId?: string
  articleId?: string
  fnName?: string
}): string {
  const account = new Account(opts.tipper, '1')
  const contract = new Contract(opts.contractId)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        opts.fnName ?? 'tip_highlight_direct',
        nativeToScVal(opts.tipper, { type: 'address' }),
        nativeToScVal(opts.highlightId ?? 'hash-abc', { type: 'string' }),
        nativeToScVal(opts.articleId ?? 'article1', { type: 'symbol' }),
        nativeToScVal(opts.author, { type: 'address' }),
        nativeToScVal(opts.amountStroops, { type: 'i128' })
      )
    )
    .setTimeout(30)
    .build()
  return tx.toEnvelope().toXDR('base64')
}

function buildHighlightBatchTipEnvelope(opts: {
  tipper: string
  author: string
  contractId: string
  amountStroops: bigint
  highlightId?: string
  articleId?: string
}): string {
  const account = new Account(opts.tipper, '1')
  const contract = new Contract(opts.contractId)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'batch_tip_highlights',
        nativeToScVal(opts.tipper, { type: 'address' }),
        nativeToScVal(
          [
            {
              highlight_id: opts.highlightId ?? 'hash-abc',
              article_id: opts.articleId ?? 'article1',
              author: opts.author,
              amount: opts.amountStroops,
            },
            {
              highlight_id: 'hash-def',
              article_id: opts.articleId ?? 'article1',
              author: opts.author,
              amount: opts.amountStroops,
            },
          ],
          {
            type: {
              highlight_id: ['symbol', 'string'],
              article_id: ['symbol', 'symbol'],
              author: ['symbol', 'address'],
              amount: ['symbol', 'i128'],
            },
          }
        )
      )
    )
    .setTimeout(30)
    .build()
  return tx.toEnvelope().toXDR('base64')
}

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

// Fixture is internally consistent at $1/XLM so the default stub (priceUsd=1)
// confirms the tip without triggering the USD cross-check. Amounts:
//   amountCents=100 ($1) <-> stellarAmountXlm='1' (1 XLM) <-> 10_000_000 stroops
function tipArgs(articleId: Id<'articles'>, stellarTxId: string) {
  return {
    highlightId: 'hash-abc',
    articleId,
    highlightText: 'some highlighted text',
    startOffset: 0,
    endOffset: 10,
    amountCents: 100,
    stellarTxId,
    stellarMemo: 'hash-abc',
    stellarSourceAccount: TIPPER_STELLAR,
    stellarDestinationAccount: AUTHOR_STELLAR,
    stellarAmountXlm: '1',
  }
}

async function insertLegacyHighlightTip(
  t: ReturnType<typeof convexTest>,
  tipperId: Id<'users'>,
  args: ReturnType<typeof tipArgs>
) {
  return await t.run(async (ctx) => {
    const [tipper, article] = await Promise.all([
      ctx.db.get(tipperId),
      ctx.db.get(args.articleId),
    ])
    if (!tipper || !article) throw new Error('Missing legacy tip fixture')
    const author = await ctx.db.get(article.authorId)
    if (!author) throw new Error('Missing legacy author fixture')
    const now = Date.now()
    return await ctx.db.insert('highlightTips', {
      highlightId: args.highlightId,
      articleId: args.articleId,
      tipperId,
      authorId: article.authorId,
      highlightText: args.highlightText,
      articleTitle: article.title,
      articleSlug: article.slug,
      tipperName: tipper.name || tipper.username,
      tipperAvatar: tipper.avatar,
      authorName: author.name || author.username,
      authorAvatar: author.avatar,
      amountUsd: args.amountCents / 100,
      amountCents: args.amountCents,
      stellarTxId: args.stellarTxId,
      stellarNetwork: 'TESTNET',
      stellarMemo: args.stellarMemo,
      stellarSourceAccount: args.stellarSourceAccount,
      stellarDestinationAccount: args.stellarDestinationAccount,
      stellarAmountXlm: args.stellarAmountXlm,
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      status: 'PENDING',
      createdAt: now,
      processedAt: now,
      updatedAt: now,
    })
  })
}
const TIP_STROOPS = BigInt(10_000_000)
const TX_ONE = '1'.repeat(64)
const TX_PUBLIC_PROJECTION = '5'.repeat(64)
const TX_PRIVATE_HISTORY = '6'.repeat(64)
const TX_OLD = '7'.repeat(64)
const TX_NEW = '8'.repeat(64)
const TX_DEFERRED_EARNING = '9'.repeat(64)
const TX_BATCH = 'a'.repeat(64)

// Skips the Horizon round-trip by directly invoking the internal mutation
// that verification would have called on success. Used by tests that want
// to exercise the final CONFIRMED state without stubbing fetch.
async function confirmPending(
  t: ReturnType<typeof convexTest>,
  tipId: Id<'highlightTips'>
) {
  await t.mutation(internal.stellarVerify.markHighlightTipConfirmed, {
    id: tipId,
    stellarLedger: 1,
  })
}

// Default stub for all tests: Horizon calls return the provided body, XLM
// price oracles return $1/XLM (matches the tipArgs fixture so the USD check
// cleanly passes). Tests that need specific XLM behavior (oracle down, price
// drift) can override via opts.xlmPriceUsd.
function stubHorizonResponse(
  body: Record<string, unknown>,
  opts: { xlmPriceUsd?: number | 'all_oracles_down' } = {}
) {
  const xlm = opts.xlmPriceUsd ?? 1
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('horizon')) {
      return {
        status: 200,
        ok: true,
        json: async () => body,
      }
    }
    if (xlm === 'all_oracles_down') {
      return { status: 500, ok: false, json: async () => ({}) }
    }
    return {
      status: 200,
      ok: true,
      json: async () => ({ stellar: { usd: xlm } }),
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('legacy highlight tip compatibility and history', () => {
  it('rejects authenticated legacy writes without altering existing history', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)
    const asTipper = t.withIdentity({ subject: tipperId })

    await expect(
      asTipper.mutation(api.highlightTips.create, tipArgs(articleId, TX_ONE))
    ).rejects.toThrow(
      'Legacy highlight tip submission is no longer supported. Prepare and submit a highlight tip intent instead.'
    )
    await t.run(async (ctx) => {
      expect(await ctx.db.query('highlightTips').collect()).toEqual([])
    })
  })

  it('hides PENDING tips from the public heatmap queries', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    await insertLegacyHighlightTip(t, tipperId, tipArgs(articleId, TX_ONE))

    const byArticle = await t.query(api.highlightTips.getByArticle, {
      articleId,
    })
    expect(byArticle).toHaveLength(0)

    const stats = await t.query(api.highlightTips.getArticleStats, {
      articleId,
    })
    expect(stats.totalTips).toBe(0)
    expect(stats.totalAmountCents).toBe(0)
  })

  it('returns aggregate-only public highlight tip data', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_PUBLIC_PROJECTION)
    )
    await confirmPending(t, tipId)

    const byHighlight = await t.query(api.highlightTips.getByHighlight, {
      highlightId: 'hash-abc',
    })
    const byArticle = await t.query(api.highlightTips.getByArticle, {
      articleId,
    })

    expect(byHighlight).toEqual({
      tipCount: 1,
      totalAmountCents: 100,
      totalAmountUsd: 1,
    })
    expect(byArticle).toEqual([
      {
        highlightId: 'hash-abc',
        highlightText: 'some highlighted text',
        startOffset: 0,
        endOffset: 10,
        totalAmountCents: 100,
        tipCount: 1,
      },
    ])

    const publicPayload = JSON.stringify({ byHighlight, byArticle })
    expect(publicPayload).not.toContain(TIPPER_STELLAR)
    expect(publicPayload).not.toContain(AUTHOR_STELLAR)
    expect(publicPayload).not.toContain(TX_PUBLIC_PROJECTION)
    expect(publicPayload).not.toContain(tipperId)
  })

  it('derives private tip history from the authenticated user', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_PRIVATE_HISTORY)
    )
    await confirmPending(t, tipId)

    const signedOutTipperHistory = await t.query(
      api.highlightTips.getByTipper,
      {}
    )
    const tipperHistory = await asTipper.query(
      api.highlightTips.getByTipper,
      {}
    )
    const authorHistory = await t
      .withIdentity({ subject: authorId })
      .query(api.highlightTips.getByAuthor, {})
    const unrelatedAuthorHistory = await asTipper.query(
      api.highlightTips.getByAuthor,
      {}
    )

    expect(signedOutTipperHistory).toEqual([])
    expect(tipperHistory.map((tip) => tip._id)).toEqual([tipId])
    expect(authorHistory.map((tip) => tip._id)).toEqual([tipId])
    expect(unrelatedAuthorHistory).toEqual([])
  })

  it('filters heatmap stats by sinceMs', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const oldTipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_OLD)
    )
    // Backdate so it falls outside the time window.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(oldTipId)
      if (tip) {
        await ctx.db.patch(oldTipId, { createdAt: tip.createdAt - 40 * 864e5 })
      }
    })
    await confirmPending(t, oldTipId)

    const newTipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_NEW)
    )
    await confirmPending(t, newTipId)

    const sinceMs = Date.now() - 30 * 864e5
    const stats = await t.query(api.highlightTips.getArticleStats, {
      articleId,
      sinceMs,
    })
    expect(stats.totalTips).toBe(1)
    expect(stats.totalAmountCents).toBe(100)
  })
})

describe('markHighlightTipConfirmed', () => {
  it('defers author earnings until highlight cents have a server-owned expectation', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_DEFERRED_EARNING)
    )
    await confirmPending(t, tipId)

    await t.run(async (ctx) => {
      const earnings = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .unique()
      expect(earnings).toBeNull()
    })
  })

  it('flips PENDING to CONFIRMED and applies counter updates', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    await confirmPending(t, tipId)

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.stellarLedger).toBe(1)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount).toBe(1)

      const author = await ctx.db.get(authorId)
      expect(author?.tipsReceivedCount).toBe(1)
    })
  })

  it('is a no-op when called twice on the same tip', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    await confirmPending(t, tipId)
    await confirmPending(t, tipId)

    await t.run(async (ctx) => {
      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)
    })
  })
})

describe('markHighlightTipFailed', () => {
  it('flips PENDING to FAILED and leaves counters untouched', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    await t.mutation(internal.stellarVerify.markHighlightTipFailed, {
      id: tipId,
      reason: 'source_mismatch',
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('source_mismatch')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)

      const author = await ctx.db.get(authorId)
      expect(author?.tipsReceivedCount ?? 0).toBe(0)
    })
  })

  it('cannot downgrade a CONFIRMED tip back to FAILED', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )
    await confirmPending(t, tipId)

    await t.mutation(internal.stellarVerify.markHighlightTipFailed, {
      id: tipId,
      reason: 'late_failure',
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
    })
  })
})

describe('verifyHighlightTip action', () => {
  it('flips to CONFIRMED when Horizon returns a matching success', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: TIP_STROOPS,
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.stellarLedger).toBe(999)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
    })
  })

  it('flips to CONFIRMED when Horizon returns a matching batch_tip_highlights', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_BATCH)
    )

    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightBatchTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: TIP_STROOPS,
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.stellarLedger).toBe(999)
    })
  })

  it('flips to FAILED on a source-account mismatch', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse({
      successful: true,
      source_account: ATTACKER_STELLAR,
      ledger: 999,
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('source_mismatch')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)
    })
  })

  it('flips to FAILED when the contract called is not the tipping contract', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: WRONG_CONTRACT_ID,
        amountStroops: BigInt(1_000_000),
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('contract_mismatch')
    })
  })

  it('flips to FAILED when the function name is not an allowed tip function', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: BigInt(1_000_000),
        fnName: 'tip_article', // article function submitted for a highlight tip
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('function_mismatch')
    })
  })

  it('flips to FAILED when the on-chain author does not match the real author', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    // Attacker pays themselves on-chain and submits that tx hash for a tip to
    // someone else. The envelope's author arg is the attacker, not the real
    // author — this is the core attack C1 exists to block.
    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: ATTACKER_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: BigInt(1_000_000),
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('author_mismatch')
    })
  })

  it('flips to FAILED when the on-chain amount is less than the declared amount', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    // Declared 0.1 XLM (1,000,000 stroops) but on-chain is 100,000 stroops
    // (0.01 XLM, the contract minimum). This is the underpay attack.
    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: BigInt(100_000),
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toBe('amount_mismatch')
    })
  })

  it('accepts an on-chain amount that exceeds the declared amount', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    // User paid slightly more than declared (e.g. price drifted up mid-build).
    // This should still confirm — the author is not harmed by overpayment.
    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: TIP_STROOPS * BigInt(2), // 2x the declared
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
    })
  })

  it('flags cents-vs-XLM inconsistency as suspicious but still confirms (warn-only)', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    // Attacker: claim amountCents=10000 ($100) but set stellarAmountXlm="0.01"
    // (paid only 100k stroops on-chain). Both fields internally consistent
    // with each other against the on-chain tx, but inconsistent with the
    // claimed USD given the real XLM price. The USD cross-check catches it
    // but — at this stage — only flags it, never fails.
    const tipId = await insertLegacyHighlightTip(t, tipperId, {
      ...tipArgs(articleId, TX_ONE),
      amountCents: 10_000, // claims $100
      stellarAmountXlm: '0.01', // but only says 0.01 XLM paid
    })

    stubHorizonResponse({
      successful: true,
      source_account: TIPPER_STELLAR,
      ledger: 999,
      envelope_xdr: buildHighlightTipEnvelope({
        tipper: TIPPER_STELLAR,
        author: AUTHOR_STELLAR,
        contractId: TIPPING_CONTRACT_ID,
        amountStroops: BigInt(100_000), // 0.01 XLM, matches declared XLM
      }),
    })

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.amountUsdSuspicious).toBe(true)
      expect(tip?.amountUsdSuspicionReason).toMatch(/^amount_usd_mismatch:/)

      const earnings = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .unique()
      expect(earnings).toBeNull()
    })
  })

  it('confirms without suspicion when price has drifted within the 25% tolerance', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    // Declared $1 (amountCents=100) paid as 1 XLM. If the verify-time XLM
    // price has dropped from $1 to $0.80, on-chain computes to $0.80, which
    // is 20% below the claimed $1 — still inside the 25% tolerance, so it
    // should confirm cleanly without a suspicion flag.
    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse(
      {
        successful: true,
        source_account: TIPPER_STELLAR,
        ledger: 999,
        envelope_xdr: buildHighlightTipEnvelope({
          tipper: TIPPER_STELLAR,
          author: AUTHOR_STELLAR,
          contractId: TIPPING_CONTRACT_ID,
          amountStroops: TIP_STROOPS,
        }),
      },
      { xlmPriceUsd: 0.8 } // $0.80 onChainUsd vs claimed $1 → 20% below
    )

    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.amountUsdSuspicious).toBeUndefined()
      expect(tip?.amountUsdSuspicionReason).toBeUndefined()
    })
  })

  it('confirms with oracle-down suspicion flag when all XLM oracles are unavailable', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    stubHorizonResponse(
      {
        successful: true,
        source_account: TIPPER_STELLAR,
        ledger: 999,
        envelope_xdr: buildHighlightTipEnvelope({
          tipper: TIPPER_STELLAR,
          author: AUTHOR_STELLAR,
          contractId: TIPPING_CONTRACT_ID,
          amountStroops: TIP_STROOPS,
        }),
      },
      { xlmPriceUsd: 'all_oracles_down' }
    )

    // Oracle failure never blocks the tip. Confirm + flag for audit.
    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: 1,
    })

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('CONFIRMED')
      expect(tip?.amountUsdSuspicious).toBe(true)
      expect(tip?.amountUsdSuspicionReason).toBe(
        'price_oracle_unavailable:all_oracles_failed'
      )

      const earnings = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', authorId))
        .unique()
      expect(earnings).toBeNull()
    })
  })

  it('flips to FAILED with verification_unreachable:* when retries are exhausted on a transient outage', async () => {
    // Horizon returns 5xx on every attempt. The first two calls reschedule
    // (attempt < HORIZON_VERIFY_MAX_ATTEMPTS); the third gives up and marks
    // the tip FAILED with the verification_unreachable: prefix that
    // monitoring/dashboards can filter on. Pins the prefix format so a
    // future refactor of the reason string surfaces here, not silently
    // breaks the alerting path.
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const tipId = await insertLegacyHighlightTip(
      t,
      tipperId,
      tipArgs(articleId, TX_ONE)
    )

    vi.stubGlobal('fetch', async () => ({
      status: 500,
      ok: false,
      json: async () => ({}),
    }))

    const { HORIZON_VERIFY_MAX_ATTEMPTS } = await import('./lib/constants')
    await t.action(internal.stellarVerify.verifyHighlightTip, {
      highlightTipId: tipId,
      attempt: HORIZON_VERIFY_MAX_ATTEMPTS, // last attempt; no reschedule after this
    })
    await t.finishAllScheduledFunctions(() => {})

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('FAILED')
      expect(tip?.failureReason).toMatch(/^verification_unreachable:/)
      // 500 from Horizon → server_error transient reason on the verifier.
      expect(tip?.failureReason).toBe('verification_unreachable:server_error')
    })
  })
})
