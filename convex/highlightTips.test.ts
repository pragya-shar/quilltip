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
const TIP_STROOPS = BigInt(10_000_000)

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

describe('highlightTips.create', () => {
  it('inserts the tip as PENDING with counters untouched', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      expect(tip?.status).toBe('PENDING')

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount ?? 0).toBe(0)
      expect(article?.totalTipsUsd ?? 0).toBe(0)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount ?? 0).toBe(0)
    })
  })

  it('dedups on non-empty stellarTxId', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    expect(second).toBe(first)

    // Counters bump only after verification; confirm the original to prove
    // dedup didn't accidentally double-credit the tip.
    await confirmPending(t, first)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(1)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(1)
      expect(article?.totalTipsUsd).toBe(1)

      const tipper = await ctx.db.get(tipperId)
      expect(tipper?.tipsSentCount).toBe(1)
    })
  })

  it('rejects when the same stellarTxId is reused for a different highlight', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-cross-highlight')
    )

    // Same txId, different highlightId — should be rejected.
    await expect(
      asTipper.mutation(api.highlightTips.create, {
        ...tipArgs(articleId, 'stellar-tx-cross-highlight'),
        highlightId: 'hash-other',
      })
    ).rejects.toThrow(/already linked to a different tip/i)
  })

  it('rejects when the same stellarTxId is reused by a different tipper', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const otherTipperId = await t.run(async (ctx) => {
      const now = Date.now()
      return await ctx.db.insert('users', {
        email: 'tipper2@x.test',
        username: 'tipper2',
        stellarAddress: TIPPER_STELLAR,
        tipsSentCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-cross-user')
    )

    const asOther = t.withIdentity({ subject: otherTipperId })
    await expect(
      asOther.mutation(
        api.highlightTips.create,
        tipArgs(articleId, 'stellar-tx-cross-user')
      )
    ).rejects.toThrow(/already linked to a different tip/i)
  })

  it('does not dedup when stellarTxId is empty', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, '')
    )
    // Backdate so the cooldown does not block the second empty-tx insert.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, '')
    )

    expect(second).not.toBe(first)

    await confirmPending(t, first)
    await confirmPending(t, second)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(2)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(2)
    })
  })

  it('does not dedup distinct non-empty stellarTxIds', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    // Backdate the first tip so the cooldown does not block the second insert.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })
    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-2')
    )

    expect(second).not.toBe(first)

    await confirmPending(t, first)
    await confirmPending(t, second)

    await t.run(async (ctx) => {
      const rows = await ctx.db.query('highlightTips').collect()
      expect(rows).toHaveLength(2)

      const article = await ctx.db.get(articleId)
      expect(article?.tipCount).toBe(2)
    })
  })

  it('rejects a second distinct-tx tip within the cooldown window', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    await expect(
      asTipper.mutation(
        api.highlightTips.create,
        tipArgs(articleId, 'stellar-tx-2')
      )
    ).rejects.toThrow(/wait .* before tipping again/i)
  })

  it('allows a second tip once the cooldown has elapsed', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    // Backdate the first tip so its createdAt is older than TIP_COOLDOWN_MS.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(first)
      if (tip) {
        await ctx.db.patch(first, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const second = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-2')
    )
    expect(second).not.toBe(first)
  })

  it('still dedups a retried stellarTxId even within the cooldown', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const first = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    const retried = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )
    expect(retried).toBe(first)
  })

  it('hides PENDING tips from the public heatmap queries', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

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

  it('filters heatmap stats by sinceMs', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const oldTipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-old')
    )
    // Backdate so it falls outside the time window.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(oldTipId)
      if (tip) {
        await ctx.db.patch(oldTipId, { createdAt: tip.createdAt - 40 * 864e5 })
      }
    })
    await confirmPending(t, oldTipId)

    // Avoid cooldown: make the first tip older so the second insert is allowed.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(oldTipId)
      if (tip) {
        await ctx.db.patch(oldTipId, { createdAt: tip.createdAt - 60_000 })
      }
    })

    const newTipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-new')
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
  it('flips PENDING to CONFIRMED and applies counter updates', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, authorId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-batch-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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
    const { tipperId, articleId } = await seed(t)

    // Attacker: claim amountCents=10000 ($100) but set stellarAmountXlm="0.01"
    // (paid only 100k stroops on-chain). Both fields internally consistent
    // with each other against the on-chain tx, but inconsistent with the
    // claimed USD given the real XLM price. The USD cross-check catches it
    // but — at this stage — only flags it, never fails.
    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(api.highlightTips.create, {
      ...tipArgs(articleId, 'stellar-tx-1'),
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
    })
  })

  it('confirms without suspicion when price has drifted within the 25% tolerance', async () => {
    const t = convexTest(schema, modules)
    const { tipperId, articleId } = await seed(t)

    // Declared $1 (amountCents=100) paid as 1 XLM. If the verify-time XLM
    // price has dropped from $1 to $0.80, on-chain computes to $0.80, which
    // is 20% below the claimed $1 — still inside the 25% tolerance, so it
    // should confirm cleanly without a suspicion flag.
    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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
    const { tipperId, articleId } = await seed(t)

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
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

    const asTipper = t.withIdentity({ subject: tipperId })
    const tipId = await asTipper.mutation(
      api.highlightTips.create,
      tipArgs(articleId, 'stellar-tx-1')
    )

    // Drain the auto-scheduled verify chain that .create kicked off — we
    // want a clean slate before driving the chain ourselves with attempt=3.
    vi.stubGlobal('fetch', async () => ({
      status: 500,
      ok: false,
      json: async () => ({}),
    }))
    await new Promise((r) => setTimeout(r, 50))
    await t.finishAllScheduledFunctions(() => {})

    // Reset the tip to PENDING so we can drive the final attempt explicitly.
    await t.run(async (ctx) => {
      const tip = await ctx.db.get(tipId)
      if (tip?.status !== 'PENDING') {
        await ctx.db.patch(tipId, {
          status: 'PENDING',
          failureReason: undefined,
        })
      }
    })

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
