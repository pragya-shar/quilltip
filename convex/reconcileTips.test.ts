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

const TIPPER_KP = Keypair.random()
const AUTHOR_KP = Keypair.random()
const ATTACKER_KP = Keypair.random()
const TIPPER_STELLAR = TIPPER_KP.publicKey()
const AUTHOR_STELLAR = AUTHOR_KP.publicKey()
const ATTACKER_STELLAR = ATTACKER_KP.publicKey()

const TIPPING_CONTRACT_ID =
  'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const WRONG_CONTRACT_ID =
  'CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S'

beforeAll(() => {
  process.env.TIPPING_CONTRACT_ID = TIPPING_CONTRACT_ID
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Reset the feature flag between tests so one test's setting doesn't
  // leak into the next.
  delete process.env.RECONCILE_TIPS_ENABLED
})

// Build a Soroban envelope calling `tip_article` on a contract. Arg layout
// matches convex/lib/horizon.ts indices: tipper=0, articleSymbol=1, author=2,
// amount=3.
function buildArticleTipEnvelope(opts: {
  tipper: string
  author: string
  contractId: string
  amountStroops: bigint
  articleSymbol?: string
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
        opts.fnName ?? 'tip_article',
        nativeToScVal(opts.tipper, { type: 'address' }),
        nativeToScVal(opts.articleSymbol ?? 'article1', { type: 'symbol' }),
        nativeToScVal(opts.author, { type: 'address' }),
        nativeToScVal(opts.amountStroops, { type: 'i128' })
      )
    )
    .setTimeout(30)
    .build()
  return tx.toEnvelope().toXDR('base64')
}

// Horizon success response shape — must include `source_account` (outer tx
// source, checked before invocation parsing) alongside the envelope XDR.
function horizonSuccessBody(envelopeXdr: string, sourceAccount: string) {
  return {
    successful: true,
    ledger: 12345,
    source_account: sourceAccount,
    envelope_xdr: envelopeXdr,
  }
}

function stubHorizonJson(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', async () => ({
    status: 200,
    ok: true,
    json: async () => body,
  }))
}

function stubHorizonStatus(status: number) {
  vi.stubGlobal('fetch', async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({}),
  }))
}

function stubHorizonThrow() {
  vi.stubGlobal('fetch', async () => {
    throw new Error('simulated network error')
  })
}

// Seed a CONFIRMED article tip by going through sendTip + direct confirmTip
// invocation. Returns ids of seeded rows so tests can assert counter state.
async function seedConfirmedTip(
  t: ReturnType<typeof convexTest>,
  overrides: {
    stellarTxId?: string
    stellarAmountXlm?: string
    amountUsd?: number
    stellarSourceAccount?: string | null
    stellarDestinationAccount?: string | null
    stellarNetwork?: string
    createdAt?: number
  } = {}
) {
  const ids = await t.run(async (ctx) => {
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

  const asTipper = t.withIdentity({ subject: ids.tipperId })
  const tipId = await asTipper.mutation(api.tips.sendTip, {
    articleId: ids.articleId,
    amountUsd: overrides.amountUsd ?? 1,
    stellarTxId: overrides.stellarTxId ?? 'tx-reconcile-fixture',
    stellarNetwork: overrides.stellarNetwork ?? 'TESTNET',
    stellarSourceAccount:
      overrides.stellarSourceAccount === null
        ? undefined
        : (overrides.stellarSourceAccount ?? TIPPER_STELLAR),
    stellarDestinationAccount:
      overrides.stellarDestinationAccount === null
        ? undefined
        : (overrides.stellarDestinationAccount ?? AUTHOR_STELLAR),
    stellarAmountXlm: overrides.stellarAmountXlm ?? '1',
  })

  // Skip the scheduler: directly run confirmTip so we land in CONFIRMED with
  // all counters credited.
  await t.mutation(internal.tips.confirmTip, { tipId })

  // Apply backdating if requested (for cutoff tests).
  if (overrides.createdAt !== undefined) {
    await t.run(async (ctx) => {
      await ctx.db.patch(tipId, { createdAt: overrides.createdAt! })
    })
  }

  return { ...ids, tipId }
}

describe('reconcileArticleTips', () => {
  it('leaves a CONFIRMED tip untouched when Horizon matches expectations', async () => {
    const t = convexTest(schema, modules)
    const { tipId, articleId, tipperId, authorId } = await seedConfirmedTip(t)

    const envelope = buildArticleTipEnvelope({
      tipper: TIPPER_STELLAR,
      author: AUTHOR_STELLAR,
      contractId: TIPPING_CONTRACT_ID,
      amountStroops: BigInt(10_000_000),
    })
    stubHorizonJson(horizonSuccessBody(envelope, TIPPER_STELLAR))

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.ok).toBe(1)
    expect(summary.flagged).toBe(0)
    expect(summary.unreachable).toBe(0)

    // Tip and counters unchanged
    const { tip, article, tipper, author } = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      article: await ctx.db.get(articleId),
      tipper: await ctx.db.get(tipperId),
      author: await ctx.db.get(authorId),
    }))
    expect(tip?.status).toBe('CONFIRMED')
    expect(article?.tipCount).toBe(1)
    expect(tipper?.tipsSentCount).toBe(1)
    expect(author?.tipsReceivedCount).toBe(1)
  })

  it('marks FRAUDULENT and reverses counters on contract_mismatch when flag is on', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId, articleId, tipperId, authorId } = await seedConfirmedTip(t)

    const envelope = buildArticleTipEnvelope({
      tipper: TIPPER_STELLAR,
      author: AUTHOR_STELLAR,
      contractId: WRONG_CONTRACT_ID, // <-- permanent mismatch
      amountStroops: BigInt(10_000_000),
    })
    stubHorizonJson(horizonSuccessBody(envelope, TIPPER_STELLAR))

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.flagged).toBe(1)
    expect(summary.ok).toBe(0)
    expect(summary.dryRun).toBe(false)

    const { tip, article, tipper, author, earnings } = await t.run(
      async (ctx) => ({
        tip: await ctx.db.get(tipId),
        article: await ctx.db.get(articleId),
        tipper: await ctx.db.get(tipperId),
        author: await ctx.db.get(authorId),
        earnings: await ctx.db
          .query('authorEarnings')
          .withIndex('by_user', (q) => q.eq('userId', authorId))
          .first(),
      })
    )

    expect(tip?.status).toBe('FRAUDULENT')
    expect(tip?.failureReason).toBe('contract_mismatch')
    expect(article?.tipCount).toBe(0)
    expect(article?.totalTipsUsd).toBe(0)
    expect(tipper?.tipsSentCount).toBe(0)
    expect(author?.tipsReceivedCount).toBe(0)
    expect(earnings?.totalEarnedCents).toBe(0)
    expect(earnings?.availableBalanceCents).toBe(0)
    expect(earnings?.tipCount).toBe(0)
  })

  it('logs but does not mutate on contract_mismatch in dry-run mode', async () => {
    // RECONCILE_TIPS_ENABLED not set — default dry-run
    const t = convexTest(schema, modules)
    const { tipId, articleId } = await seedConfirmedTip(t)

    const envelope = buildArticleTipEnvelope({
      tipper: TIPPER_STELLAR,
      author: AUTHOR_STELLAR,
      contractId: WRONG_CONTRACT_ID,
      amountStroops: BigInt(10_000_000),
    })
    stubHorizonJson(horizonSuccessBody(envelope, TIPPER_STELLAR))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.flagged).toBe(1)
    expect(summary.dryRun).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      '[reconcileTips] DRY-RUN would mark FRAUDULENT',
      expect.objectContaining({ reason: 'contract_mismatch' })
    )

    const { tip, article } = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      article: await ctx.db.get(articleId),
    }))
    expect(tip?.status).toBe('CONFIRMED')
    expect(tip?.failureReason).toBeUndefined()
    expect(article?.tipCount).toBe(1)

    warnSpy.mockRestore()
  })

  it('marks FRAUDULENT with source_mismatch when outer tx source diverges from stored source', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId } = await seedConfirmedTip(t)

    const envelope = buildArticleTipEnvelope({
      tipper: ATTACKER_STELLAR, // outer tx source = attacker
      author: AUTHOR_STELLAR,
      contractId: TIPPING_CONTRACT_ID,
      amountStroops: BigInt(10_000_000),
    })
    // source_account in the Horizon response also = attacker, so source check
    // at horizon.ts:104 fires before invocation parsing runs.
    stubHorizonJson(horizonSuccessBody(envelope, ATTACKER_STELLAR))

    await t.action(internal.reconcileTips.reconcileArticleTips, {})

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip?.status).toBe('FRAUDULENT')
    expect(tip?.failureReason).toBe('source_mismatch')
  })

  it('marks FRAUDULENT with amount_mismatch when on-chain amount is less than stored amount', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId } = await seedConfirmedTip(t)

    // Envelope says we only moved 1 stroop on-chain while the stored
    // stellarAmountXlm = '1' = 10_000_000 stroops. Underpay.
    const envelope = buildArticleTipEnvelope({
      tipper: TIPPER_STELLAR,
      author: AUTHOR_STELLAR,
      contractId: TIPPING_CONTRACT_ID,
      amountStroops: BigInt(1),
    })
    stubHorizonJson(horizonSuccessBody(envelope, TIPPER_STELLAR))

    await t.action(internal.reconcileTips.reconcileArticleTips, {})

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip?.status).toBe('FRAUDULENT')
    expect(tip?.failureReason).toBe('amount_mismatch')
  })

  it('does not mark fraudulent when Horizon returns 404 (transient not_found)', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId } = await seedConfirmedTip(t)

    stubHorizonStatus(404)

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.unreachable).toBe(1)
    expect(summary.flagged).toBe(0)

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip?.status).toBe('CONFIRMED')
  })

  it('does not mark fraudulent when fetch throws (network error)', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId } = await seedConfirmedTip(t)

    stubHorizonThrow()

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.unreachable).toBe(1)
    expect(summary.flagged).toBe(0)

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip?.status).toBe('CONFIRMED')
  })

  it('skips legacy tips with stellarTxId starting with pending_', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    await seedConfirmedTip(t, { stellarTxId: 'pending_legacy' })

    // Stub horizon anyway — if the action calls it, something is wrong
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.skipped).toBe(1)
    expect(summary.checked).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips tips created outside the 7-hour window', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const eightHoursAgo = Date.now() - 8 * 60 * 60 * 1000
    await seedConfirmedTip(t, { createdAt: eightHoursAgo })

    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    // The old tip shouldn't even show up in the query
    expect(summary.checked).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips tips when the author has no stellarAddress', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { authorId } = await seedConfirmedTip(t)

    // Clear the author's stellarAddress
    await t.run(async (ctx) => {
      await ctx.db.patch(authorId, { stellarAddress: undefined })
    })

    const fetchSpy = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const summary = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary.skipped).toBe(1)
    expect(summary.checked).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is idempotent: running reconciliation twice does not double-reverse counters', async () => {
    process.env.RECONCILE_TIPS_ENABLED = 'true'
    const t = convexTest(schema, modules)
    const { tipId, articleId, tipperId } = await seedConfirmedTip(t)

    const envelope = buildArticleTipEnvelope({
      tipper: TIPPER_STELLAR,
      author: AUTHOR_STELLAR,
      contractId: WRONG_CONTRACT_ID,
      amountStroops: BigInt(10_000_000),
    })
    stubHorizonJson(horizonSuccessBody(envelope, TIPPER_STELLAR))

    // First pass: marks FRAUDULENT, counters go to 0
    await t.action(internal.reconcileTips.reconcileArticleTips, {})

    // Second pass: tip is already FRAUDULENT; by_status_created filters to
    // CONFIRMED so the second pass should not even load it.
    const summary2 = await t.action(
      internal.reconcileTips.reconcileArticleTips,
      {}
    )

    expect(summary2.checked).toBe(0)

    const { tip, article, tipper } = await t.run(async (ctx) => ({
      tip: await ctx.db.get(tipId),
      article: await ctx.db.get(articleId),
      tipper: await ctx.db.get(tipperId),
    }))
    expect(tip?.status).toBe('FRAUDULENT')
    expect(article?.tipCount).toBe(0)
    expect(tipper?.tipsSentCount).toBe(0)
  })
})

// Insert a PENDING highlightTips row directly (bypassing the create
// mutation) so we can control createdAt and skip the auto-scheduled verify.
async function seedPendingHighlightTip(
  t: ReturnType<typeof convexTest>,
  overrides: {
    createdAt?: number
    status?: 'PENDING' | 'CONFIRMED' | 'FAILED'
    stellarTxId?: string
  } = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const tipperId = await ctx.db.insert('users', {
      email: 'h-tipper@x.test',
      username: 'h-tipper',
      stellarAddress: TIPPER_STELLAR,
      tipsSentCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await ctx.db.insert('users', {
      email: 'h-author@x.test',
      username: 'h-author',
      stellarAddress: AUTHOR_STELLAR,
      tipsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const articleId: Id<'articles'> = await ctx.db.insert('articles', {
      slug: 'h-hello',
      title: 'Hello',
      content: emptyDoc,
      published: true,
      publishedAt: now,
      authorId,
      authorUsername: 'h-author',
      tags: [],
      viewCount: 0,
      highlightCount: 0,
      tipCount: 0,
      totalTipsUsd: 0,
      createdAt: now,
      updatedAt: now,
    })
    const tipId = await ctx.db.insert('highlightTips', {
      highlightId: 'hash-stuck',
      articleId,
      tipperId,
      authorId,
      highlightText: 'stuck text',
      articleTitle: 'Hello',
      articleSlug: 'h-hello',
      amountUsd: 1,
      amountCents: 100,
      stellarTxId: overrides.stellarTxId ?? 'stuck-stellar-tx',
      stellarNetwork: 'TESTNET',
      stellarMemo: 'hash-stuck',
      stellarSourceAccount: TIPPER_STELLAR,
      stellarDestinationAccount: AUTHOR_STELLAR,
      stellarAmountXlm: '1',
      startOffset: 0,
      endOffset: 10,
      status: overrides.status ?? 'PENDING',
      createdAt: overrides.createdAt ?? now,
      processedAt: now,
      updatedAt: now,
    })
    return { tipId, articleId, tipperId, authorId }
  })
}

// Asserts on the action's contract: which rows it picks up and re-kicks.
// The verify chain itself (Horizon stub → CONFIRMED/FAILED transitions) is
// covered in highlightTips.test.ts. Tests that schedule a verify must drain
// the scheduler before teardown — leaving a verify in flight surfaces as a
// "Write outside of transaction" unhandled rejection. We stub Horizon to
// return a malformed response, which the verifier treats as a permanent
// failure (no further reschedule), giving the chain a clean exit.
function stubMalformedHorizonResponse() {
  vi.stubGlobal('fetch', async () => ({
    status: 200,
    ok: true,
    json: async () => ({ unexpected: 'shape' }),
  }))
}

// Drain everything the action just scheduled. The yield gives queued
// setTimeout(0) callbacks a chance to fire and move scheduled jobs into the
// 'inProgress' state that `finishAllScheduledFunctions` knows how to await;
// without it, a `runAfter(0, ...)` job stays 'pending' past test teardown
// and re-fires onto a closed transaction.
async function drainScheduler(t: ReturnType<typeof convexTest>) {
  await new Promise((resolve) => setTimeout(resolve, 50))
  await t.finishAllScheduledFunctions(() => {})
  await new Promise((resolve) => setTimeout(resolve, 50))
  await t.finishAllScheduledFunctions(() => {})
}

describe('recoverStuckPendingHighlightTips', () => {
  it('reschedules a PENDING tip older than the stuck threshold', async () => {
    const t = convexTest(schema, modules)
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000
    await seedPendingHighlightTip(t, { createdAt: elevenMinutesAgo })
    stubMalformedHorizonResponse()

    const summary = await t.action(
      internal.reconcileTips.recoverStuckPendingHighlightTips,
      {}
    )
    expect(summary.rescheduled).toBe(1)

    await drainScheduler(t)
  })

  it('leaves a freshly-created PENDING tip alone', async () => {
    const t = convexTest(schema, modules)
    const oneMinuteAgo = Date.now() - 60 * 1000
    const { tipId } = await seedPendingHighlightTip(t, {
      createdAt: oneMinuteAgo,
    })

    const summary = await t.action(
      internal.reconcileTips.recoverStuckPendingHighlightTips,
      {}
    )
    expect(summary.rescheduled).toBe(0)

    const tip = await t.run(async (ctx) => ctx.db.get(tipId))
    expect(tip?.status).toBe('PENDING')
  })

  it('ignores CONFIRMED and FAILED tips even when older than the threshold', async () => {
    const t = convexTest(schema, modules)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    await seedPendingHighlightTip(t, {
      createdAt: twoHoursAgo,
      status: 'CONFIRMED',
      stellarTxId: 'confirmed-tx',
    })
    await seedPendingHighlightTip(t, {
      createdAt: twoHoursAgo,
      status: 'FAILED',
      stellarTxId: 'failed-tx',
    })

    const summary = await t.action(
      internal.reconcileTips.recoverStuckPendingHighlightTips,
      {}
    )
    expect(summary.rescheduled).toBe(0)
  })

  it('reschedules every stuck tip in a single sweep', async () => {
    const t = convexTest(schema, modules)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    await seedPendingHighlightTip(t, {
      createdAt: twoHoursAgo,
      stellarTxId: 'stuck-1',
    })
    await seedPendingHighlightTip(t, {
      createdAt: twoHoursAgo,
      stellarTxId: 'stuck-2',
    })
    await seedPendingHighlightTip(t, {
      createdAt: twoHoursAgo,
      stellarTxId: 'stuck-3',
    })
    stubMalformedHorizonResponse()

    const summary = await t.action(
      internal.reconcileTips.recoverStuckPendingHighlightTips,
      {}
    )
    expect(summary.rescheduled).toBe(3)

    await drainScheduler(t)
  })
})
