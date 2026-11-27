/// <reference types="vite/client" />
// Tip read queries and author earnings for v1 and v2 rows
// (docs/architecture/v2/06-app-integration.md, sections 6.2 and 6.3).
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  applyStoredTippedEvent,
  applyFailure,
  prepareTipSubmission,
  type PrepareTipItem,
  type StoredTippedEvent,
} from '../../convex/lib/chain/submissionStore'
import { recipientShares } from '../../convex/lib/v2Earnings'
import { AGGREGATE_LIMIT, MAX_PAGE_SIZE } from '../../convex/lib/tipReads'
import { AUTHOR, CORE, OTHER_AUTHOR, TIPPER, TOKEN } from '../chain/fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const ARTICLE_KEY = '81'.repeat(32)
const HIGHLIGHT_KEY = 'e3'.repeat(32)
const CONTENT_HASH = 'a1'.repeat(32)
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0)
// Fixture users proved control of their addresses on testnet.
const VERIFIED = {
  stellarAddressVerifiedAt: T0,
  stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  const env = {
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: 'testnet-test',
    CORE_CONTRACT_ID: CORE,
    TOKEN_CONTRACT_ID: TOKEN,
  }
  for (const [k, value] of Object.entries(env)) vi.stubEnv(k, value)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function newTest() {
  return convexTest(schema, modules)
}

type T = ReturnType<typeof newTest>

async function seed(t: T) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: AUTHOR,
      ...VERIFIED,
      createdAt: now,
      updatedAt: now,
    })
    const readerId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      stellarAddress: TIPPER,
      ...VERIFIED,
      createdAt: now,
      updatedAt: now,
    })
    const coAuthorId = await db.insert('users', {
      username: 'coauthor',
      email: 'coauthor@example.test',
      stellarAddress: OTHER_AUTHOR,
      ...VERIFIED,
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
    return { authorId, readerId, coAuthorId, articleId }
  })
}

type Seeded = Awaited<ReturnType<typeof seed>>

function asUser(t: T, userId: Id<'users'>) {
  return t.withIdentity({ subject: `${userId}|session` })
}

async function registerArticle(
  t: T,
  s: Seeded,
  opts: {
    status?: 'REGISTERED' | 'SUBMITTED'
    totals?: Record<string, string>
    splits?: Array<{ recipient: string; bps: number }>
    chainEpoch?: string
  } = {}
) {
  await t.run(({ db }) =>
    db.insert('chainArticles', {
      network: 'TESTNET',
      chainEpoch: opts.chainEpoch ?? 'testnet-test',
      articleId: s.articleId,
      articleKey: ARTICLE_KEY,
      authorAddress: AUTHOR,
      contentHash: CONTENT_HASH,
      contentVersion: 1,
      splits: opts.splits ?? [],
      totals: opts.totals ?? {},
      status: opts.status ?? 'REGISTERED',
      updatedAt: Date.now(),
    })
  )
}

function articleItem(s: Seeded, gross: string, cents: number): PrepareTipItem {
  return {
    table: 'tips',
    fields: {
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: cents / 100,
      amountCents: cents,
    },
    articleKey: ARTICLE_KEY,
    authorAddress: AUTHOR,
    grossBaseUnits: gross,
  }
}

function highlightItem(
  s: Seeded,
  gross: string,
  cents: number,
  highlightId = 'passage-1'
): PrepareTipItem {
  return {
    table: 'highlightTips',
    fields: {
      highlightId,
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      highlightText: 'The quick brown fox',
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: cents / 100,
      amountCents: cents,
      startOffset: 10,
      endOffset: 29,
    },
    articleKey: ARTICLE_KEY,
    highlightKey: HIGHLIGHT_KEY,
    authorAddress: AUTHOR,
    grossBaseUnits: gross,
  }
}

let requestCounter = 0

async function prepare(t: T, s: Seeded, items: PrepareTipItem[]) {
  requestCounter += 1
  return t.run((ctx) =>
    prepareTipSubmission(ctx, {
      userId: s.readerId,
      requestId: `req-${requestCounter}`,
      tipperAddress: TIPPER,
      items,
      now: Date.now(),
    })
  )
}

function fee(gross: bigint): bigint {
  return (gross * BigInt(250)) / BigInt(10_000)
}

/** Applies a `Tipped` event to the row with `clientRef` (rule (b)). */
async function applyEvent(
  t: T,
  clientRef: string,
  gross: bigint,
  opts: { author?: string; highlight?: boolean; totalAfter?: bigint } = {}
) {
  const event: StoredTippedEvent = {
    article_id: ARTICLE_KEY,
    author: opts.author ?? AUTHOR,
    tipper: TIPPER,
    token: TOKEN,
    gross: gross.toString(),
    fee: fee(gross).toString(),
    net: (gross - fee(gross)).toString(),
    highlight_id: opts.highlight ? HIGHLIGHT_KEY : null,
    content_hash: CONTENT_HASH,
    content_version: 1,
    client_ref: clientRef,
    total_after: (opts.totalAfter ?? gross).toString(),
    split_count: 0,
  }
  return t.run((ctx) =>
    applyStoredTippedEvent(ctx, {
      contractId: CORE,
      txHash: 'ab'.repeat(32),
      ledger: 1000,
      eventId: `event-${clientRef}`,
      event,
      now: Date.now(),
    })
  )
}

/** A v1 row: verified CONFIRMED by default. */
async function insertV1Tip(
  t: T,
  s: Seeded,
  opts: {
    status?: string
    verified?: boolean
    cents?: number
    stroops?: string
  } = {}
) {
  return t.run(({ db }) =>
    db.insert('tips', {
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: (opts.cents ?? 100) / 100,
      amountCents: opts.cents ?? 100,
      expectedAmountStroops: opts.stroops ?? '4000000',
      stellarNetwork: 'TESTNET',
      status: opts.status ?? 'CONFIRMED',
      ...(opts.verified === false ? {} : { verifiedAt: Date.now() }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
}

async function insertV1HighlightTip(
  t: T,
  s: Seeded,
  highlightId: string,
  cents: number
) {
  return t.run(({ db }) =>
    db.insert('highlightTips', {
      highlightId,
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      highlightText: 'The quick brown fox',
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: cents / 100,
      amountCents: cents,
      startOffset: 10,
      endOffset: 29,
      stellarTxId: 'cd'.repeat(32),
      stellarNetwork: 'TESTNET',
      stellarMemo: highlightId,
      status: 'CONFIRMED',
      verifiedAt: Date.now(),
      createdAt: Date.now(),
      processedAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
}

async function sync(t: T) {
  return t.mutation(internal.tipEarnings.syncV2TipEarnings, {})
}

async function earningsOf(t: T, userId: Id<'users'>) {
  return t.run(({ db }) =>
    db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
  )
}

describe('authorEarnings for v2 direct and batch tips', () => {
  it('CONFIRMED credits the recorded on-chain net once', async () => {
    const t = newTest()
    const s = await seed(t)
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    expect(await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))).toBe(
      'linked'
    )

    expect(await sync(t)).toMatchObject({ credited: 1 })
    expect(await sync(t)).toMatchObject({ credited: 0 })

    const earnings = await earningsOf(t, s.authorId)
    // net = 1,000,000 − floor(1,000,000 × 250 / 10,000) = 975,000
    expect(earnings).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '975000' },
      v2TipCount: 1,
      tipCount: 1,
      // 25 cents × 975,000 / 1,000,000
      totalEarnedCents: 24.375,
      v2EarnedCents: 24.375,
    })
  })

  it('MISMATCH credits the on-chain author, not the expected author', async () => {
    const t = newTest()
    const s = await seed(t)
    const { clientRefs } = await prepare(t, s, [articleItem(s, '2000000', 50)])
    await applyEvent(t, clientRefs[0]!, BigInt(2_000_000), {
      author: OTHER_AUTHOR,
    })
    const row = await t.run(({ db }) =>
      db
        .query('tips')
        .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRefs[0]!))
        .first()
    )
    expect(row).toMatchObject({ status: 'MISMATCH', mismatchReason: 'author' })

    await sync(t)
    expect(await earningsOf(t, s.authorId)).toBeNull()
    expect(await earningsOf(t, s.coAuthorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '1950000' },
      v2TipCount: 1,
    })

    // The expected author does not see it as received; the stats count it.
    const received = await asUser(t, s.authorId).query(
      api.tips.getUserReceivedTips,
      {}
    )
    expect(received).toHaveLength(0)
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats).toMatchObject({ totalTips: 1, byVersion: { v1: 0, v2: 1 } })
  })

  it('an address with no Quilltip user credits nobody', async () => {
    const t = newTest()
    const s = await seed(t)
    await t.run(({ db }) => db.patch(s.coAuthorId, { stellarAddress: null }))
    const { clientRefs } = await prepare(t, s, [articleItem(s, '400000', 10)])
    await applyEvent(t, clientRefs[0]!, BigInt(400_000), {
      author: OTHER_AUTHOR,
    })
    await sync(t)
    expect(await earningsOf(t, s.authorId)).toBeNull()
    expect(await earningsOf(t, s.coAuthorId)).toBeNull()
    const row = await t.run(({ db }) =>
      db
        .query('tips')
        .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRefs[0]!))
        .first()
    )
    expect(row?.earningsAppliedAt).toBeGreaterThanOrEqual(T0)
  })

  it('a batch credits every item', async () => {
    const t = newTest()
    const s = await seed(t)
    const { clientRefs } = await prepare(t, s, [
      articleItem(s, '1000000', 25),
      highlightItem(s, '3000000', 75),
    ])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    await applyEvent(t, clientRefs[1]!, BigInt(3_000_000), { highlight: true })
    await sync(t)
    // 975,000 + 2,925,000
    expect(await earningsOf(t, s.authorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '3900000' },
      v2TipCount: 2,
      totalEarnedCents: 97.5,
    })
  })

  it('co-author splits divide net with the contract rule', async () => {
    const t = newTest()
    const s = await seed(t)
    await registerArticle(t, s, {
      splits: [
        { recipient: AUTHOR, bps: 7_000 },
        { recipient: OTHER_AUTHOR, bps: 3_000 },
      ],
    })
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000001', 40)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_001))
    await sync(t)
    // net = 1,000,001 − 25,000 = 975,001; co-author floor(975,001 × 0.3) = 292,500
    expect(await earningsOf(t, s.coAuthorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '292500' },
    })
    expect(await earningsOf(t, s.authorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '682501' },
    })
  })

  it('unverified and failed v2 rows earn nothing', async () => {
    const t = newTest()
    const s = await seed(t)
    await prepare(t, s, [articleItem(s, '1000000', 25)])
    const failed = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await t.run((ctx) =>
      applyFailure(ctx, {
        submissionId: failed.submissionId,
        from: 'PREPARED',
        reason: 'send_error',
        now: Date.now(),
      })
    )
    await sync(t)
    expect(await earningsOf(t, s.authorId)).toBeNull()
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats.totalTips).toBe(0)
  })

  it('v1 rows are left to the v1 path', async () => {
    const t = newTest()
    const s = await seed(t)
    await insertV1Tip(t, s)
    expect(await sync(t)).toMatchObject({ credited: 0 })
    expect(await earningsOf(t, s.authorId)).toBeNull()
  })

  it('splits whose first recipient is not the on-chain author pay the author all of net', () => {
    expect(
      recipientShares(BigInt(975_000), AUTHOR, [
        { recipient: OTHER_AUTHOR, bps: 5_000 },
        { recipient: AUTHOR, bps: 5_000 },
      ])
    ).toEqual([{ address: AUTHOR, share: BigInt(975_000) }])
  })
})

describe('article tip reads with v1 and v2 rows', () => {
  async function mixedHistory(t: T, s: Seeded) {
    await registerArticle(t, s, { totals: { [TOKEN]: '9000000' } })
    await insertV1Tip(t, s, { cents: 100 })
    await insertV1Tip(t, s, { cents: 200, verified: false }) // unverified
    await insertV1Tip(t, s, { cents: 300, status: 'PENDING', verified: false })
    const a = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, a.clientRefs[0]!, BigInt(1_000_000))
    const b = await prepare(t, s, [articleItem(s, '2000000', 50)])
    await applyEvent(t, b.clientRefs[0]!, BigInt(2_000_000), {
      author: OTHER_AUTHOR,
    })
    await prepare(t, s, [articleItem(s, '5000000', 125)]) // still PREPARED
  }

  it('stats count verified v1 rows and paid v2 rows, with chain totals', async () => {
    const t = newTest()
    const s = await seed(t)
    await mixedHistory(t, s)
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats).toEqual({
      totalTips: 3,
      totalAmountUsd: 1.75,
      uniqueTippers: 1,
      byVersion: { v1: 1, v2: 2 },
      totalsBaseUnits: { [TOKEN]: '9000000' },
      registered: true,
      network: 'TESTNET',
      complete: true,
    })
  })

  it('chain totals are hidden until the article is registered', async () => {
    const t = newTest()
    const s = await seed(t)
    await registerArticle(t, s, {
      status: 'SUBMITTED',
      totals: { [TOKEN]: '1' },
    })
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats).toMatchObject({ totalsBaseUnits: {}, registered: false })
  })

  it('public lists are labelled and expose no private fields', async () => {
    const t = newTest()
    const s = await seed(t)
    await mixedHistory(t, s)
    const list = await t.query(api.tips.getArticleTips, {
      articleId: s.articleId,
    })
    expect(list.map((tip) => tip.contractVersion).sort()).toEqual([
      'v1',
      'v2',
      'v2',
    ])
    const text = JSON.stringify(list)
    for (const field of [
      'email',
      'expectedTipperAddress',
      'expectedAuthorAddress',
      'quotePriceUsd',
      'needsReview',
      'mismatchReason',
      'requestId',
    ]) {
      expect(text).not.toContain(field)
    }
    const v2 = list.find(
      (tip) => tip.contractVersion === 'v2' && tip.status === 'CONFIRMED'
    )
    expect(v2?.chain).toMatchObject({
      grossBaseUnits: '1000000',
      feeBaseUnits: '25000',
      netBaseUnits: '975000',
      tokenContractId: TOKEN,
    })
    expect(v2?.network).toBe('TESTNET')
  })

  it('the tipper sees every status of their own history, labelled', async () => {
    const t = newTest()
    const s = await seed(t)
    await mixedHistory(t, s)
    const sent = await asUser(t, s.readerId).query(api.tips.getUserSentTips, {})
    expect(sent).toHaveLength(6)
    expect(sent.filter((tip) => tip.contractVersion === 'v1')).toHaveLength(3)
    expect(new Set(sent.map((tip) => tip.status))).toEqual(
      new Set(['CONFIRMED', 'PENDING', 'MISMATCH', 'PREPARED'])
    )
  })

  it('the author receives only payments that reached them', async () => {
    const t = newTest()
    const s = await seed(t)
    await mixedHistory(t, s)
    const received = await asUser(t, s.authorId).query(
      api.tips.getUserReceivedTips,
      {}
    )
    expect(
      received.map((tip) => [tip.contractVersion, tip.status]).sort()
    ).toEqual([
      ['v1', 'CONFIRMED'],
      ['v2', 'CONFIRMED'],
    ])
  })

  it('pages through an article list with a clamped page size', async () => {
    const t = newTest()
    const s = await seed(t)
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(T0 + i * 1000)
      await insertV1Tip(t, s, { cents: 10 + i })
    }
    const first = await t.query(api.tips.listArticleTips, {
      articleId: s.articleId,
      paginationOpts: { numItems: 2, cursor: null },
    })
    expect(first.page.map((tip) => tip.amountCents)).toEqual([14, 13])
    expect(first.isDone).toBe(false)
    const second = await t.query(api.tips.listArticleTips, {
      articleId: s.articleId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    })
    expect(second.page.map((tip) => tip.amountCents)).toEqual([12, 11])
    const all = await t.query(api.tips.listArticleTips, {
      articleId: s.articleId,
      paginationOpts: { numItems: 10_000, cursor: null },
    })
    expect(all.page).toHaveLength(5)
    expect(MAX_PAGE_SIZE).toBe(100)
  })

  it('paginated own history is empty for anonymous callers', async () => {
    const t = newTest()
    const s = await seed(t)
    await insertV1Tip(t, s)
    const page = await t.query(api.tips.listMySentTips, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page).toEqual({ page: [], isDone: true, continueCursor: '' })
    const mine = await asUser(t, s.readerId).query(api.tips.listMySentTips, {
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(mine.page).toHaveLength(1)
    const notMine = await asUser(t, s.coAuthorId).query(
      api.tips.listMySentTips,
      { paginationOpts: { numItems: 10, cursor: null } }
    )
    expect(notMine.page).toHaveLength(0)
  })

  it('aggregates report incomplete beyond the read bound', async () => {
    const t = newTest()
    const s = await seed(t)
    await t.run(async ({ db }) => {
      for (let i = 0; i <= AGGREGATE_LIMIT; i += 1) {
        await db.insert('tips', {
          articleId: s.articleId,
          tipperId: s.readerId,
          authorId: s.authorId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.01,
          amountCents: 1,
          status: 'CONFIRMED',
          verifiedAt: T0,
          createdAt: T0,
          updatedAt: T0,
        })
      }
    })
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats).toMatchObject({ totalTips: AGGREGATE_LIMIT, complete: false })
  })
})

describe('canTip', () => {
  it('requires a registered article when an article is given', async () => {
    const t = newTest()
    const s = await seed(t)
    expect(await t.query(api.tips.canTip, { articleId: s.articleId })).toEqual({
      allowed: false,
      waitSec: 0,
      reason: 'NOT_REGISTERED',
    })
    await registerArticle(t, s)
    expect(
      await asUser(t, s.readerId).query(api.tips.canTip, {
        articleId: s.articleId,
      })
    ).toEqual({ allowed: true })
    expect(await t.query(api.tips.canTip, {})).toEqual({ allowed: true })
  })

  it('ignores a registration from an earlier chain epoch', async () => {
    const t = newTest()
    const s = await seed(t)
    await registerArticle(t, s, {
      chainEpoch: 'testnet-previous',
      totals: { [TOKEN]: '5000000' },
    })
    expect(await t.query(api.tips.canTip, { articleId: s.articleId })).toEqual({
      allowed: false,
      waitSec: 0,
      reason: 'NOT_REGISTERED',
    })
    expect(
      await t.query(api.tips.getArticleTipStats, { articleId: s.articleId })
    ).toMatchObject({ totalsBaseUnits: {}, registered: false })

    // A registration in the current epoch is used, even when the old row
    // comes first in the index.
    await registerArticle(t, s, { totals: { [TOKEN]: '7000000' } })
    expect(await t.query(api.tips.canTip, { articleId: s.articleId })).toEqual({
      allowed: true,
    })
    expect(
      await t.query(api.tips.getArticleTipStats, { articleId: s.articleId })
    ).toMatchObject({
      totalsBaseUnits: { [TOKEN]: '7000000' },
      registered: true,
    })
  })
})

describe('highlight tip reads', () => {
  it('the heatmap groups paid v1 and v2 tips by passage', async () => {
    const t = newTest()
    const s = await seed(t)
    await insertV1HighlightTip(t, s, 'passage-1', 100)
    await insertV1HighlightTip(t, s, 'passage-2', 40)
    const { clientRefs } = await prepare(t, s, [
      highlightItem(s, '3000000', 75, 'passage-1'),
    ])
    await applyEvent(t, clientRefs[0]!, BigInt(3_000_000), { highlight: true })
    await prepare(t, s, [highlightItem(s, '9000000', 900, 'passage-2')]) // unpaid

    const groups = await t.query(api.highlightTips.getByArticle, {
      articleId: s.articleId,
    })
    const byId = Object.fromEntries(groups.map((g) => [g.highlightId, g]))
    expect(byId['passage-1']).toMatchObject({
      tipCount: 2,
      totalAmountCents: 175,
      grossBaseUnits: { [TOKEN]: '3000000' },
    })
    expect(byId['passage-2']).toMatchObject({
      tipCount: 1,
      totalAmountCents: 40,
      grossBaseUnits: {},
    })
    expect(JSON.stringify(groups)).not.toContain('tipperId')

    const stats = await t.query(api.highlightTips.getArticleStats, {
      articleId: s.articleId,
    })
    expect(stats).toMatchObject({
      totalTips: 3,
      totalAmountCents: 215,
      byVersion: { v1: 2, v2: 1 },
      grossBaseUnits: { [TOKEN]: '3000000' },
      complete: true,
    })
    expect(stats.topHighlights[0]?.highlightId).toBe('passage-1')

    const one = await t.query(api.highlightTips.getByHighlight, {
      highlightId: 'passage-1',
    })
    expect(one).toMatchObject({ tipCount: 2, totalAmountCents: 175 })
  })

  it('author and tipper histories are labelled and owner-only', async () => {
    const t = newTest()
    const s = await seed(t)
    await insertV1HighlightTip(t, s, 'passage-1', 100)
    const { clientRefs } = await prepare(t, s, [
      highlightItem(s, '3000000', 75),
    ])
    await applyEvent(t, clientRefs[0]!, BigInt(3_000_000), { highlight: true })

    const received = await asUser(t, s.authorId).query(
      api.highlightTips.getByAuthor,
      {}
    )
    expect(received.map((tip) => tip.contractVersion).sort()).toEqual([
      'v1',
      'v2',
    ])
    const sent = await asUser(t, s.readerId).query(
      api.highlightTips.listMySent,
      { paginationOpts: { numItems: 1, cursor: null } }
    )
    expect(sent.page).toHaveLength(1)
    expect(sent.isDone).toBe(false)
    expect(await t.query(api.highlightTips.getByAuthor, {})).toEqual([])
    expect(
      await asUser(t, s.coAuthorId).query(api.highlightTips.getByAuthor, {})
    ).toEqual([])
  })
})

describe('earnings access and mixed summary', () => {
  it('only the owner reads their earnings', async () => {
    const t = newTest()
    const s = await seed(t)
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    await sync(t)

    expect(await t.query(api.tips.getAuthorEarnings, {})).toBeNull()
    expect(await t.query(api.tips.getMyEarningsSummary, {})).toBeNull()
    expect(
      await asUser(t, s.readerId).query(api.tips.getAuthorEarnings, {})
    ).toBeNull()
    const own = await asUser(t, s.authorId).query(
      api.tips.getAuthorEarnings,
      {}
    )
    expect(own?.userId).toBe(s.authorId)
  })

  it('wallet tips only: XLM, USD and count cover the same tips (#552)', async () => {
    const t = newTest()
    const s = await seed(t)
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    await sync(t)
    expect(
      await asUser(t, s.authorId).query(api.tips.getMyEarningsSummary, {})
    ).toMatchObject({
      tipCount: 1,
      // 97.5 % of 0.1 XLM, and of 25 cents.
      earnedStroops: '975000',
      estimatedUsd: 0.24375,
    })
  })

  it('the summary adds v1 rows and v2 earnings, labelled testnet', async () => {
    const t = newTest()
    const s = await seed(t)
    // v1: 4,000,000 stroops → writer share 3,900,000; 100 cents → 97.5
    await insertV1Tip(t, s, { cents: 100, stroops: '4000000' })
    await insertV1Tip(t, s, { cents: 100, verified: false })
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    await sync(t)

    const summary = await asUser(t, s.authorId).query(
      api.tips.getMyEarningsSummary,
      {}
    )
    expect(summary).toEqual({
      network: 'TESTNET',
      tipCount: 2,
      writerShareStroops: '3900000',
      // The XLM the stats show: 3,900,000 (v1) + 975,000 (v2) stroops, the
      // same tips `estimatedUsd` counts (#547).
      earnedStroops: '4875000',
      // 97.5 (v1) + 24.375 (v2) cents
      estimatedUsd: 1.21875,
      earnedBaseUnits: { [TOKEN]: '975000' },
      v2TipCount: 1,
      unpricedTipCount: 0,
      complete: true,
      updating: false,
    })
  })

  // The live totals equal the totals rebuilt from history (#552): forget
  // them as a row from before this change, read the history, rebuild, and
  // compare the three reads.
  async function bothReads(t: T, userId: Id<'users'>) {
    const read = () =>
      asUser(t, userId).query(api.tips.getMyEarningsSummary, {})
    const live = await read()
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('authorEarnings').collect()).find(
        (r) => r.userId === userId
      )!
      await ctx.db.patch(row._id, {
        v1TipCount: undefined,
        v1EarnedCents: undefined,
        v1ShareStroops: undefined,
        v1UnpricedTipCount: undefined,
        tabTipCount: undefined,
        tabEarnedCents: undefined,
        tabSettledBaseUnits: undefined,
        walletEarnedBaseUnits: undefined,
        lifetimeTotalsAt: undefined,
      })
    })
    expect(await read()).toEqual(live)
    await t.action(internal.earningsTotalsBackfill.run, {})
    const row = await earningsOf(t, userId)
    expect(row?.lifetimeTotalsAt).toBeTypeOf('number')
    expect(await read()).toEqual(live)
    return live!
  }

  it('v1 rows and v2 rows: a legacy tip without a trusted USD amount keeps its XLM and its place in the count (#552)', async () => {
    const t = newTest()
    const s = await seed(t)
    // v1: 4,000,000 stroops and 100 cents → 3,900,000 stroops, 97.5 cents.
    await insertV1Tip(t, s, { cents: 100, stroops: '4000000' })
    // v1, flagged: 2 XLM on chain → 19,500,000 stroops; its USD is unknown.
    const flagged = await insertV1HighlightTip(t, s, 'h-flagged', 200)
    await t.run(({ db }) =>
      db.patch(flagged, { amountUsdSuspicious: true, stellarAmountXlm: '2' })
    )
    // v2 wallet: 1,000,000 base units and 25 cents → 975,000, 24.375 cents.
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    await sync(t)

    expect(await bothReads(t, s.authorId)).toMatchObject({
      tipCount: 3,
      writerShareStroops: '23400000',
      earnedStroops: '24375000',
      // The flagged tip adds no dollars: the USD is a lower bound.
      estimatedUsd: 1.21875,
      unpricedTipCount: 1,
      complete: true,
    })
  })

  it('co-author splits: each recipient reads their share, not the gross (#552)', async () => {
    const t = newTest()
    const s = await seed(t)
    await registerArticle(t, s, {
      splits: [
        { recipient: AUTHOR, bps: 7_000 },
        { recipient: OTHER_AUTHOR, bps: 3_000 },
      ],
    })
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000001', 40)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_001))
    await sync(t)
    // net 975,001: the co-author 292,500 and the author 682,501, and the
    // 40 cents in the same proportion of gross.
    expect(await bothReads(t, s.coAuthorId)).toMatchObject({
      tipCount: 1,
      earnedStroops: '292500',
      estimatedUsd: 0.117,
      complete: true,
    })
    expect(await bothReads(t, s.authorId)).toMatchObject({
      tipCount: 1,
      earnedStroops: '682501',
      estimatedUsd: 0.273,
      complete: true,
    })
  })
})

describe('earnings sync robustness', () => {
  async function rowByRef(t: T, clientRef: string) {
    return t.run(({ db }) =>
      db
        .query('tips')
        .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRef))
        .first()
    )
  }

  async function syncUntilDone(t: T) {
    for (let i = 0; i < 10; i += 1) {
      const result = await sync(t)
      if (!result.more) return
    }
    throw new Error('the earnings sync did not finish')
  }

  it('credits a row confirmed with an older updatedAt after an earlier sync', async () => {
    const t = newTest()
    const s = await seed(t)
    const first = await prepare(t, s, [articleItem(s, '1000000', 25)])
    const second = await prepare(t, s, [articleItem(s, '2000000', 50)])
    await applyEvent(t, first.clientRefs[0]!, BigInt(1_000_000))
    vi.setSystemTime(T0 + 60_000)
    await sync(t)

    // A verification that started earlier commits after the sync.
    await applyEvent(t, second.clientRefs[0]!, BigInt(2_000_000))
    const late = await rowByRef(t, second.clientRefs[0]!)
    await t.run(({ db }) => db.patch(late!._id, { updatedAt: T0 - 60_000 }))
    await sync(t)

    // 975,000 + 1,950,000
    expect(await earningsOf(t, s.authorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '2925000' },
      v2TipCount: 2,
    })
  })

  it('credits every row when more than one page shares one updatedAt', async () => {
    const t = newTest()
    const s = await seed(t)
    const refs: string[] = []
    for (let batch = 0; batch < 6; batch += 1) {
      const items = Array.from({ length: 10 }, () =>
        articleItem(s, '1000000', 25)
      )
      const { clientRefs } = await prepare(t, s, items)
      refs.push(...clientRefs)
    }
    for (const ref of refs) await applyEvent(t, ref, BigInt(1_000_000))
    // Fake timers: every row carries the same updatedAt.
    await syncUntilDone(t)

    // 60 × 975,000
    expect(await earningsOf(t, s.authorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '58500000' },
      v2TipCount: 60,
    })
  })

  it('holds a MISMATCH that needs review out of counts and earnings', async () => {
    const t = newTest()
    const s = await seed(t)
    await registerArticle(t, s)
    const { clientRefs } = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, clientRefs[0]!, BigInt(1_000_000))
    const row = await rowByRef(t, clientRefs[0]!)
    await t.run(({ db }) =>
      db.patch(row!._id, {
        status: 'MISMATCH',
        mismatchReason: 'field:gross',
        needsReview: true,
      })
    )
    await sync(t)

    expect(await earningsOf(t, s.authorId)).toBeNull()
    expect(await rowByRef(t, clientRefs[0]!)).toMatchObject({
      earningsSkipReason: 'needs_review',
    })
    const stats = await t.query(api.tips.getArticleTipStats, {
      articleId: s.articleId,
    })
    expect(stats.totalTips).toBe(0)
    const list = await t.query(api.tips.getArticleTips, {
      articleId: s.articleId,
    })
    expect(list).toHaveLength(0)
  })

  it('unverified copies of an address neither take nor block credit', async () => {
    const t = newTest()
    const s = await seed(t)
    // Two more accounts link the co-author's and the author's addresses
    // without proving control of them.
    await t.run(async ({ db }) => {
      const now = Date.now()
      for (const [username, address] of [
        ['copy-coauthor', OTHER_AUTHOR],
        ['copy-author', AUTHOR],
      ] as const) {
        await db.insert('users', {
          username,
          email: `${username}@example.test`,
          stellarAddress: address,
          createdAt: now,
          updatedAt: now,
        })
      }
    })
    const mismatch = await prepare(t, s, [articleItem(s, '2000000', 50)])
    await applyEvent(t, mismatch.clientRefs[0]!, BigInt(2_000_000), {
      author: OTHER_AUTHOR,
    })
    const confirmed = await prepare(t, s, [articleItem(s, '1000000', 25)])
    await applyEvent(t, confirmed.clientRefs[0]!, BigInt(1_000_000))
    await sync(t)

    // The co-author is the only verified holder of the on-chain address.
    expect(await earningsOf(t, s.coAuthorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '1950000' },
    })
    const copies = await t.run(({ db }) =>
      db
        .query('authorEarnings')
        .collect()
        .then((rows) => rows.filter((r) => r.userId !== s.authorId))
    )
    expect(copies.filter((r) => r.userId !== s.coAuthorId)).toHaveLength(0)
    expect(await earningsOf(t, s.authorId)).toMatchObject({
      earnedBaseUnits: { [TOKEN]: '975000' },
      v2TipCount: 1,
    })
  })
})
