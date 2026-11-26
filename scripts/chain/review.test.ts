/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  applyStoredTippedEvent,
  prepareTipSubmission,
  type PrepareTipItem,
} from '../../convex/lib/chain/submissionStore'
import {
  AUTHOR,
  CORE,
  OTHER_AUTHOR,
  OTHER_TOKEN,
  TIPPER,
  TOKEN,
  fakeRpcFetch,
  notFoundResponse,
  seedAddress,
  successResponse,
  tippedEventXdr,
} from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const ARTICLE_KEY = 'ab'.repeat(32)
const HIGHLIGHT_KEY =
  'e3551930d1b1612eda907c05db04be6588619981e505e04e465885aef7480584'
const HASH = 'c3'.repeat(32)
const T0 = Date.UTC(2026, 11, 3, 12, 0, 0)
const OTHER_TIPPER = seedAddress(60)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: 'testnet-review',
    CORE_CONTRACT_ID: CORE,
    TOKEN_CONTRACT_ID: TOKEN,
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type T = ReturnType<typeof convexTest>

async function seed(t: T) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: AUTHOR,
      // Proved control of the address on testnet.
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: now,
      updatedAt: now,
    })
    const readerId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      stellarAddress: TIPPER,
      // Proved control of the address on testnet.
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: now,
      updatedAt: now,
    })
    const opsId = await db.insert('users', {
      username: 'operator',
      email: 'ops@example.test',
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
    return { authorId, readerId, opsId, articleId }
  })
}

type Seeded = Awaited<ReturnType<typeof seed>>

function item(s: Seeded, highlight = false): PrepareTipItem {
  const base = {
    articleId: s.articleId,
    tipperId: s.readerId,
    authorId: s.authorId,
    articleTitle: 'Words',
    articleSlug: 'words',
    amountUsd: 0.25,
    amountCents: 25,
  }
  return highlight
    ? {
        table: 'highlightTips',
        fields: {
          ...base,
          highlightId: HIGHLIGHT_KEY.slice(0, 28),
          highlightText: 'The quick brown fox',
          startOffset: 1,
          endOffset: 20,
        },
        articleKey: ARTICLE_KEY,
        highlightKey: HIGHLIGHT_KEY,
        authorAddress: AUTHOR,
        grossBaseUnits: '1000000',
      }
    : {
        table: 'tips',
        fields: base,
        articleKey: ARTICLE_KEY,
        authorAddress: AUTHOR,
        grossBaseUnits: '1000000',
      }
}

async function prepare(t: T, s: Seeded, highlight = false) {
  return t.run((ctx) =>
    prepareTipSubmission(ctx, {
      userId: s.readerId,
      requestId: `req-${Math.random().toString(36).slice(2)}`,
      tipperAddress: TIPPER,
      items: [item(s, highlight)],
      now: Date.now(),
    })
  )
}

function tipped(clientRef: string, overrides: Record<string, unknown> = {}) {
  return tippedEventXdr({
    articleId: ARTICLE_KEY,
    author: AUTHOR,
    tipper: TIPPER,
    token: TOKEN,
    gross: BigInt(1_000_000),
    clientRef,
    ...overrides,
  })
}

/** Records the hash and runs verification against one `getTransaction` reply. */
async function verifyWith(
  t: T,
  s: Seeded,
  submissionId: Id<'chainSubmissions'>,
  reply: unknown
) {
  vi.stubGlobal(
    'fetch',
    fakeRpcFetch(() => reply)
  )
  await t
    .withIdentity({ subject: `${s.readerId}|session` })
    .mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
}

async function row(t: T, prepared: Awaited<ReturnType<typeof prepare>>) {
  const link = prepared.related[0]!
  return t.run(async (ctx) =>
    link.table === 'tips'
      ? await ctx.db.get(link.id as Id<'tips'>)
      : await ctx.db.get(link.id as Id<'highlightTips'>)
  )
}

async function flagged(t: T, s: Seeded) {
  vi.stubEnv('OPS_USER_IDS', s.opsId)
  return t
    .withIdentity({ subject: `${s.opsId}|session` })
    .query(api.chain.review.getFlaggedTips, {})
}

async function articleStats(t: T, s: Seeded) {
  return t.query(api.tips.getArticleTipStats, { articleId: s.articleId })
}

async function earnings(t: T, s: Seeded) {
  await t.mutation(internal.tipEarnings.syncV2TipEarnings, {})
  return t.run(async (ctx) => {
    const rows = await ctx.db.query('authorEarnings').collect()
    return rows.find((r) => r.userId === s.authorId) ?? null
  })
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<{ code: string }>).data.code
}

const FIELD_CASES: Array<
  [string, Record<string, unknown>, Record<string, unknown>, boolean?]
> = [
  [
    'article_id',
    { articleId: 'cd'.repeat(32) },
    { articleKey: 'cd'.repeat(32) },
  ],
  ['tipper', { tipper: OTHER_TIPPER }, { tipper: OTHER_TIPPER }],
  ['token', { token: OTHER_TOKEN }, { token: OTHER_TOKEN }],
  [
    'gross',
    { gross: BigInt(3_000_000) },
    { gross: '3000000', fee: '75000', net: '2925000' },
  ],
  ['fee', { fee: BigInt(1) }, { fee: '1', net: '999999' }],
  [
    'highlight_id',
    { highlightId: HIGHLIGHT_KEY },
    { highlightKey: HIGHLIGHT_KEY },
  ],
]

describe('flagged rows keep the decoded on-chain values', () => {
  it.each(FIELD_CASES)(
    'field:%s keeps expected and decoded values, is listed for operators and is not counted or credited',
    async (field, change, decodedChange) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const prepared = await prepare(t, s)
      const ref = prepared.clientRefs[0]!
      await verifyWith(
        t,
        s,
        prepared.submissionId,
        successResponse(HASH, [[tipped(ref, change)]])
      )

      const tip = await row(t, prepared)
      expect(tip).toMatchObject({
        status: 'MISMATCH',
        mismatchReason: `field:${field}`,
        needsReview: true,
        // Expected values are unchanged.
        grossBaseUnits: '1000000',
        tokenContractId: TOKEN,
        expectedTipperAddress: TIPPER,
        expectedAuthorAddress: AUTHOR,
        chainArticleKey: ARTICLE_KEY,
      })

      const list = await flagged(t, s)
      expect(list!.rows).toHaveLength(1)
      const entry = list!.rows[0]!
      expect(entry.expected).toEqual({
        tipper: TIPPER,
        author: AUTHOR,
        token: TOKEN,
        gross: '1000000',
        articleKey: ARTICLE_KEY,
        highlightKey: null,
        clientRef: ref,
      })
      expect(entry.decoded).toEqual({
        tipper: TIPPER,
        author: AUTHOR,
        token: TOKEN,
        gross: '1000000',
        fee: '25000',
        net: '975000',
        articleKey: ARTICLE_KEY,
        highlightKey: null,
        clientRef: ref,
        ...decodedChange,
      })
      expect(entry.mismatchReason).toBe(`field:${field}`)

      expect(await articleStats(t, s)).toMatchObject({ totalTips: 0 })
      const credited = await earnings(t, s)
      expect(credited?.earnedBaseUnits ?? {}).toEqual({})
      expect(await row(t, prepared)).toMatchObject({
        earningsSkipReason: 'needs_review',
      })
    }
  )

  it('a highlight tip without the highlight on chain keeps the decoded null', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s, true)
    await verifyWith(
      t,
      s,
      prepared.submissionId,
      successResponse(HASH, [[tipped(prepared.clientRefs[0]!)]])
    )
    const entry = (await flagged(t, s))!.rows[0]!
    expect(entry).toMatchObject({
      table: 'highlightTips',
      mismatchReason: 'field:highlight_id',
      differing: ['highlightKey'],
    })
    expect(entry.expected.highlightKey).toBe(HIGHLIGHT_KEY)
    expect(entry.decoded!.highlightKey).toBeNull()
  })

  it('no_event has nothing decoded and stays out of counts', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s)
    await verifyWith(t, s, prepared.submissionId, successResponse(HASH, [[]]))
    const entry = (await flagged(t, s))!.rows[0]!
    expect(entry).toMatchObject({
      mismatchReason: 'no_event',
      decoded: null,
      differing: [],
      creditable: false,
    })
    expect(await articleStats(t, s)).toMatchObject({ totalTips: 0 })
  })

  it('two events with one client_ref keep the first decoded event', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s)
    const ref = prepared.clientRefs[0]!
    await verifyWith(
      t,
      s,
      prepared.submissionId,
      successResponse(HASH, [[tipped(ref), tipped(ref)]])
    )
    const entry = (await flagged(t, s))!.rows[0]!
    expect(entry.mismatchReason).toBe('field:client_ref')
    expect(entry.decoded!.gross).toBe('1000000')
    expect(entry.creditable).toBe(false)
  })

  it('an author mismatch is not flagged: it counts and credits the on-chain author', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s)
    await verifyWith(
      t,
      s,
      prepared.submissionId,
      successResponse(HASH, [
        [tipped(prepared.clientRefs[0]!, { author: OTHER_AUTHOR })],
      ])
    )
    expect(await row(t, prepared)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'author',
      needsReview: false,
      onChainAuthorAddress: OTHER_AUTHOR,
      onChainGrossBaseUnits: '1000000',
    })
    expect((await flagged(t, s))!.rows).toHaveLength(0)
    expect(await articleStats(t, s)).toMatchObject({ totalTips: 1 })
  })

  it('an event that contradicts a client-reported failure records the decoded payment', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s)
    await t
      .withIdentity({ subject: `${s.readerId}|session` })
      .mutation(api.chain.submissions.recordSendFailed, {
        submissionId: prepared.submissionId,
        reason: 'send_error',
      })
    const result = await t.run((ctx) =>
      applyStoredTippedEvent(ctx, {
        contractId: CORE,
        txHash: HASH,
        ledger: 6_000_010,
        eventId: 'evt-after-failure',
        event: {
          article_id: ARTICLE_KEY,
          author: AUTHOR,
          tipper: TIPPER,
          token: TOKEN,
          gross: '1000000',
          fee: '25000',
          net: '975000',
          highlight_id: null,
          content_hash: 'ab'.repeat(32),
          content_version: 1,
          client_ref: prepared.clientRefs[0]!,
          total_after: '1000000',
          split_count: 0,
        },
        now: Date.now(),
      })
    )
    expect(result).toBe('conflict')
    const entry = (await flagged(t, s))!.rows[0]!
    expect(entry).toMatchObject({
      status: 'FAILED',
      mismatchReason: 'event_after_failure',
      creditable: false,
    })
    expect(entry.decoded).toMatchObject({ gross: '1000000', net: '975000' })
    expect(await row(t, prepared)).toMatchObject({
      chainEventId: 'evt-after-failure',
    })
    expect(await articleStats(t, s)).toMatchObject({ totalTips: 0 })
  })

  it('a confirmed row keeps the decoded values too and is not listed', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await prepare(t, s)
    await verifyWith(
      t,
      s,
      prepared.submissionId,
      successResponse(HASH, [[tipped(prepared.clientRefs[0]!)]])
    )
    expect(await row(t, prepared)).toMatchObject({
      status: 'CONFIRMED',
      onChainTipperAddress: TIPPER,
      onChainTokenContractId: TOKEN,
      onChainGrossBaseUnits: '1000000',
      onChainArticleKey: ARTICLE_KEY,
      onChainHighlightKey: null,
      onChainClientRef: prepared.clientRefs[0],
    })
    expect((await flagged(t, s))!.rows).toHaveLength(0)
  })
})

describe('resolving a flagged row', () => {
  async function flaggedGross(
    t: T,
    s: Seeded,
    change: Record<string, unknown>
  ) {
    const prepared = await prepare(t, s)
    await verifyWith(
      t,
      s,
      prepared.submissionId,
      successResponse(HASH, [[tipped(prepared.clientRefs[0]!, change)]])
    )
    await earnings(t, s)
    return prepared
  }

  it('lists a flagged row even behind many newer unflagged FAILED rows', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // A FAILED row flagged because its payment landed after all.
    const prepared = await prepare(t, s)
    await t
      .withIdentity({ subject: `${s.readerId}|session` })
      .mutation(api.chain.submissions.recordSendFailed, {
        submissionId: prepared.submissionId,
        reason: 'send_error',
      })
    await t.run((ctx) =>
      applyStoredTippedEvent(ctx, {
        contractId: CORE,
        txHash: HASH,
        ledger: 6_000_010,
        eventId: 'evt-after-failure',
        event: {
          article_id: ARTICLE_KEY,
          author: AUTHOR,
          tipper: TIPPER,
          token: TOKEN,
          gross: '1000000',
          fee: '25000',
          net: '975000',
          highlight_id: null,
          content_hash: 'ab'.repeat(32),
          content_version: 1,
          client_ref: prepared.clientRefs[0]!,
          total_after: '1000000',
          split_count: 0,
        },
        now: Date.now(),
      })
    )
    // Newer v1 FAILED tips share the status but are not flagged.
    vi.setSystemTime(Date.now() + 60_000)
    await t.run(async ({ db }) => {
      for (let i = 0; i < 60; i++) {
        await db.insert('tips', {
          articleId: s.articleId,
          tipperId: s.readerId,
          authorId: s.authorId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 1,
          amountCents: 100,
          stellarNetwork: 'TESTNET',
          status: 'FAILED',
          createdAt: Date.now() + i,
          updatedAt: Date.now() + i,
        })
      }
    })
    const list = await flagged(t, s)
    expect(list!.rows.map((r) => r.id)).toContain(prepared.related[0]!.id)
  })

  it('credits with the splits of the row’s chain epoch, not an earlier one', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const other = seedAddress(77)
    // After a testnet reset an earlier epoch's row with the same article key
    // exists first, with splits that no longer apply.
    await t.run(async ({ db }) => {
      await db.insert('chainArticles', {
        network: 'TESTNET',
        chainEpoch: 'testnet-before-reset',
        articleId: s.articleId,
        articleKey: ARTICLE_KEY,
        authorAddress: AUTHOR,
        contentHash: '00'.repeat(32),
        contentVersion: 1,
        splits: [
          { recipient: AUTHOR, bps: 5_000 },
          { recipient: other, bps: 5_000 },
        ],
        totals: {},
        status: 'REGISTERED',
        updatedAt: Date.now(),
      })
    })
    const prepared = await flaggedGross(t, s, { gross: BigInt(3_000_000) })
    await t.mutation(internal.chain.review.resolveFlaggedTip, {
      table: 'tips',
      rowId: prepared.related[0]!.id,
      resolution: 'credit_decoded',
      note: 'Amount verified on chain.',
    })
    const credited = await earnings(t, s)
    // No current-epoch row: the whole net goes to the on-chain author.
    expect(credited!.earnedBaseUnits).toEqual({ [TOKEN]: '2925000' })
  })

  it('credit_decoded counts the row and credits the decoded net and token', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await flaggedGross(t, s, {
      gross: BigInt(3_000_000),
      token: OTHER_TOKEN,
    })
    // The first difference decides the reason; both values are decoded.
    expect((await row(t, prepared))!.mismatchReason).toBe('field:token')
    await t.mutation(internal.chain.review.resolveFlaggedTip, {
      table: 'tips',
      rowId: prepared.related[0]!.id,
      resolution: 'credit_decoded',
      note: 'Reader paid with the other token; amount verified on chain.',
    })
    expect(await articleStats(t, s)).toMatchObject({ totalTips: 1 })
    const credited = await earnings(t, s)
    expect(credited!.earnedBaseUnits).toEqual({ [OTHER_TOKEN]: '2925000' })
    expect((await flagged(t, s))!.rows).toHaveLength(0)
    expect(await row(t, prepared)).toMatchObject({
      needsReview: false,
      reviewResolution: 'credit_decoded',
      status: 'MISMATCH',
    })
  })

  it('no_credit keeps the row out of counts and earnings', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await flaggedGross(t, s, { gross: BigInt(3_000_000) })
    await t.mutation(internal.chain.review.resolveFlaggedTip, {
      table: 'tips',
      rowId: prepared.related[0]!.id,
      resolution: 'no_credit',
      note: 'Refunded off-platform.',
    })
    expect(await articleStats(t, s)).toMatchObject({ totalTips: 0 })
    const credited = await earnings(t, s)
    expect(credited?.earnedBaseUnits ?? {}).toEqual({})
    expect(await row(t, prepared)).toMatchObject({
      earningsSkipReason: 'review_no_credit',
    })
  })

  it('refuses crediting rows whose decoded event is not a payment to this article', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const wrongArticle = await flaggedGross(t, s, {
      articleId: 'cd'.repeat(32),
    })
    expect(
      await errorCode(
        t.mutation(internal.chain.review.resolveFlaggedTip, {
          table: 'tips',
          rowId: wrongArticle.related[0]!.id,
          resolution: 'credit_decoded',
          note: 'x',
        })
      )
    ).toBe('NOT_CREDITABLE')
    // no_credit is always allowed for a flagged row.
    await t.mutation(internal.chain.review.resolveFlaggedTip, {
      table: 'tips',
      rowId: wrongArticle.related[0]!.id,
      resolution: 'no_credit',
      note: 'Paid another article.',
    })
    expect(
      await errorCode(
        t.mutation(internal.chain.review.resolveFlaggedTip, {
          table: 'tips',
          rowId: wrongArticle.related[0]!.id,
          resolution: 'no_credit',
          note: 'again',
        })
      )
    ).toBe('NOT_FLAGGED')
  })

  it('requires a note and refuses off testnet', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await flaggedGross(t, s, { gross: BigInt(3_000_000) })
    expect(
      await errorCode(
        t.mutation(internal.chain.review.resolveFlaggedTip, {
          table: 'tips',
          rowId: prepared.related[0]!.id,
          resolution: 'no_credit',
          note: '  ',
        })
      )
    ).toBe('NOTE_REQUIRED')
    vi.stubEnv('STELLAR_NETWORK', 'MAINNET')
    await expect(
      t.mutation(internal.chain.review.resolveFlaggedTip, {
        table: 'tips',
        rowId: prepared.related[0]!.id,
        resolution: 'no_credit',
        note: 'x',
      })
    ).rejects.toThrow()
  })
})

describe('operations access', () => {
  it('getFlaggedTips answers only users in OPS_USER_IDS', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubGlobal(
      'fetch',
      fakeRpcFetch(() => notFoundResponse(HASH))
    )
    expect(await t.query(api.chain.review.getFlaggedTips, {})).toBeNull()
    expect(
      await t
        .withIdentity({ subject: `${s.readerId}|session` })
        .query(api.chain.review.getFlaggedTips, {})
    ).toBeNull()
    expect(await flagged(t, s)).toEqual({ rows: [], sampleLimit: 400 })
  })
})
