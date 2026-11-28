/// <reference types="vite/client" />
// v2 direct, highlight and batch tip prepare and status
// (docs/architecture/v2/05-flows-and-admin.md, sections 5.2 to 5.4;
// 06-app-integration.md, sections 6.1 to 6.4; 07-security-and-recovery.md,
// I-21, I-24 and section 7.3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  MAX_BATCH_TRANSFERS,
  PRICE_MAX_AGE_MS,
  RECORD_RATE_LIMIT,
  RECORD_RATE_WINDOW_MS,
  TIP_V2_ERROR_CODES,
  baseUnitsToXlm,
  centsToBaseUnits,
  highlightSource,
  minimumCents,
  tipCanRetry,
  tipUiState,
  type PreparedTip,
} from '../../convex/lib/chain/tipPrepare'
import { EXPIRY_COVERAGE_MARGIN_SECONDS } from '../../convex/lib/chain/submissionStore'
import { highlightIdHex } from '../../convex/lib/chain/ids'
import {
  AUTHOR,
  CORE,
  OTHER_AUTHOR,
  TIPPER,
  TOKEN,
  fakeRpcFetch,
  failedResponse,
  feeOf,
  notFoundResponse,
  seedAddress,
  successResponse,
  tippedEventXdr,
} from '../chain/fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const PASSPHRASE = 'Test SDF Network ; September 2015'
const EPOCH = 'testnet-test'
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0)
const PRICE = 0.25 // USD per XLM: 100 cents = 4 XLM.
const MIN_TIP = '10000000' // 1 XLM = 25 cents at PRICE.
const ARTICLE_KEY = '81'.repeat(32)
const SPLIT_KEY_5 = '85'.repeat(32)
const SPLIT_KEY_2 = '82'.repeat(32)
const HASH = 'a1'.repeat(32)
const HASH2 = 'b2'.repeat(32)
const VERIFIED = {
  stellarAddressVerifiedAt: T0,
  stellarAddressVerifiedNetwork: PASSPHRASE,
}
const COAUTHORS = [seedAddress(31), seedAddress(32), seedAddress(33)]
const READER2 = seedAddress(41)

const vectors = JSON.parse(
  readFileSync(
    join(__dirname, '../../contracts/shared/test-vectors.json'),
    'utf8'
  )
) as {
  identifiers: {
    highlight_ids: Array<{
      highlight_id: string
      source: string
      v1_convex_id: string
    }>
  }
}

// The first shared vector: "on-writing-well:120:163:The quick brown fox …".
const HL_TEXT = 'The quick brown fox jumps over the lazy dog'
const HL_START = 120
const HL_END = HL_START + HL_TEXT.length
const BODY = `${'x'.repeat(HL_START)}${HL_TEXT} and then some more words.`

function stubChainEnv(overrides: Record<string, string> = {}) {
  const env = {
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    CORE_CONTRACT_ID: CORE,
    TOKEN_CONTRACT_ID: TOKEN,
    ...overrides,
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  stubChainEnv()
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
    const user = (username: string, address?: string, verified = true) =>
      db.insert('users', {
        username,
        email: `${username}@example.test`,
        ...(address ? { stellarAddress: address } : {}),
        ...(address && verified ? VERIFIED : {}),
        createdAt: now,
        updatedAt: now,
      })
    const authorId = await user('writer', AUTHOR)
    const readerId = await user('reader', TIPPER)
    const reader2Id = await user('reader2', READER2)
    const noWalletId = await user('nowallet')
    const unverifiedId = await user('unverified', seedAddress(42), false)
    const coauthorId = await user('coauthor', COAUTHORS[0])
    const article = (slug: string, published = true) =>
      db.insert('articles', {
        slug,
        title: slug,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: BODY }] },
          ],
        },
        published,
        authorId,
        authorUsername: 'writer',
        createdAt: now,
        updatedAt: now,
      })
    const articleId = await article('on-writing-well')
    const split5Id = await article('split-five')
    const split2Id = await article('split-two')
    const draftId = await article('draft', false)
    const unregisteredId = await article('unregistered')
    const register = (
      id: Id<'articles'>,
      articleKey: string,
      splits: Array<{ recipient: string; bps: number }> = []
    ) =>
      db.insert('chainArticles', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        articleId: id,
        articleKey,
        authorAddress: AUTHOR,
        contentHash: 'ab'.repeat(32),
        contentVersion: 1,
        splits,
        totals: {},
        status: 'REGISTERED',
        updatedAt: now,
      })
    await register(articleId, ARTICLE_KEY)
    await register(split5Id, SPLIT_KEY_5, [
      { recipient: AUTHOR, bps: 6_000 },
      ...[...COAUTHORS, seedAddress(34)].map((recipient) => ({
        recipient,
        bps: 1_000,
      })),
    ])
    await register(split2Id, SPLIT_KEY_2, [
      { recipient: AUTHOR, bps: 5_000 },
      { recipient: COAUTHORS[0]!, bps: 5_000 },
    ])
    await db.insert('chainConfig', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      coreContractId: CORE,
      tokenContractId: TOKEN,
      minTip: MIN_TIP,
      feeBps: 250,
      paused: { core: false },
      refreshedAt: now,
    })
    await db.insert('xlmPriceCache', {
      priceUsd: PRICE,
      source: 'CoinGecko',
      fetchedAt: now,
    })
    return {
      authorId,
      readerId,
      reader2Id,
      noWalletId,
      unverifiedId,
      coauthorId,
      articleId,
      split5Id,
      split2Id,
      draftId,
      unregisteredId,
    }
  })
}

type Seeded = Awaited<ReturnType<typeof seed>>

function as(t: T, userId: Id<'users'>) {
  return t.withIdentity({ subject: `${userId}|session` })
}

async function errorData(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  const data = (error as { data: Record<string, unknown> }).data
  expect(TIP_V2_ERROR_CODES).toContain(data.code)
  return data as { code: string; itemIndex?: number } & Record<string, unknown>
}

async function code(promise: Promise<unknown>) {
  return (await errorData(promise)).code
}

let requestSeq = 0
function rid() {
  requestSeq += 1
  return `req-${requestSeq}`
}

function direct(
  t: T,
  userId: Id<'users'>,
  articleId: Id<'articles'>,
  amountCents = 100,
  requestId = rid()
) {
  return as(t, userId).mutation(api.tipsV2.prepareDirectTip, {
    requestId,
    articleId,
    amountCents,
  })
}

function highlight(
  t: T,
  s: Seeded,
  overrides: Partial<{
    text: string
    startOffset: number
    endOffset: number
  }> = {},
  requestId = rid()
) {
  return as(t, s.readerId).mutation(api.tipsV2.prepareHighlightTip, {
    requestId,
    articleId: s.articleId,
    amountCents: 50,
    highlight: {
      text: HL_TEXT,
      startOffset: HL_START,
      endOffset: HL_END,
      ...overrides,
    },
  })
}

function batch(
  t: T,
  userId: Id<'users'>,
  items: Array<{
    articleId: Id<'articles'>
    amountCents?: number
    highlight?: boolean
  }>,
  requestId = rid()
) {
  return as(t, userId).mutation(api.tipsV2.prepareBatch, {
    requestId,
    items: items.map((item) => ({
      articleId: item.articleId,
      amountCents: item.amountCents ?? 100,
      ...(item.highlight
        ? {
            highlight: {
              text: HL_TEXT,
              startOffset: HL_START,
              endOffset: HL_END,
            },
          }
        : {}),
    })),
  })
}

function stubRpc(responder: Parameters<typeof fakeRpcFetch>[0]) {
  const fetch = fakeRpcFetch(responder)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function eventFor(
  prepared: PreparedTip,
  index: number,
  overrides: Record<string, unknown> = {}
) {
  const input = prepared.items[index]!.tipInput
  return tippedEventXdr({
    articleId: input.article_id,
    author: prepared.items[index]!.authorAddress,
    tipper: prepared.tipperAddress,
    token: prepared.tokenContractId,
    gross: BigInt(input.amount),
    highlightId: input.highlight_id,
    clientRef: input.client_ref,
    ...overrides,
  })
}

/** Records the hash through tipsV2 and runs the scheduled verification. */
async function submitAndVerify(
  t: T,
  s: Seeded,
  prepared: PreparedTip,
  respond: () => unknown,
  hash = HASH
) {
  stubRpc(respond)
  const recorded = await as(t, s.readerId).mutation(
    api.tipsV2.recordSubmitted,
    { tipId: prepared.items[0]!.tipId, txHash: hash }
  )
  expect(recorded).toMatchObject({
    submissionId: prepared.submissionId,
    status: 'SUBMITTED',
    duplicate: false,
  })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
  return status(t, s, prepared)
}

async function status(t: T, s: Seeded, prepared: PreparedTip) {
  const result = await as(t, s.readerId).query(api.tipsV2.getTipStatus, {
    submissionId: prepared.submissionId,
  })
  expect(result).not.toBeNull()
  return result!
}

async function setCursor(t: T, lastLedgerCloseTime: number) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('chainCursor').collect()) {
      await ctx.db.delete(row._id)
    }
    await ctx.db.insert('chainCursor', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      lastLedger: 6_000_050,
      lastLedgerCloseTime,
      latestLedger: 6_000_060,
      oldestLedger: 5_879_140,
      lagLedgers: 10,
      status: 'OK',
      updatedAt: Date.now(),
    })
  })
}

describe('amount helpers', () => {
  it('converts cents with the stored quote, rounding down', () => {
    expect(centsToBaseUnits(100, PRICE)).toBe(BigInt(40_000_000))
    expect(centsToBaseUnits(1, 0.3)).toBe(BigInt(333_333))
    expect(baseUnitsToXlm(BigInt(40_000_000))).toBe('4')
    expect(baseUnitsToXlm('333333')).toBe('0.0333333')
    expect(minimumCents(BigInt(MIN_TIP), PRICE)).toBe(25)
    // The smallest cent amount always converts to at least min_tip.
    for (const price of [0.1, 0.2234, 0.3333, 0.47, 1.9]) {
      const cents = minimumCents(BigInt(MIN_TIP), price)
      expect(centsToBaseUnits(cents, price)).toBeGreaterThanOrEqual(
        BigInt(MIN_TIP)
      )
      expect(centsToBaseUnits(cents - 1, price)).toBeLessThan(BigInt(MIN_TIP))
    }
  })

  it.each(vectors.identifiers.highlight_ids)(
    'derives highlight_id for $source',
    async ({ source, highlight_id, v1_convex_id }) => {
      const [slug, start, end, ...rest] = source.split(':')
      const text = rest.join(':')
      expect(highlightSource(slug!, Number(start), Number(end), text)).toBe(
        source
      )
      expect(await highlightIdHex(source)).toBe(highlight_id)
      expect(highlight_id.slice(0, 28)).toBe(v1_convex_id)
    }
  )

  it('maps every status to a UI state and offers retry only for FAILED and EXPIRED', () => {
    const cases: Array<[string, string | null, boolean, string, boolean]> = [
      ['PREPARED', null, false, 'checking', false],
      ['SUBMITTED', null, false, 'checking', false],
      ['SUBMITTED', null, true, 'checking', false],
      ['CONFIRMED', null, false, 'confirmed', false],
      ['MISMATCH', 'author', false, 'mismatch_author', false],
      ['MISMATCH', 'field:gross', true, 'mismatch_review', false],
      ['MISMATCH', 'field:ledger', true, 'mismatch_review', false],
      ['MISMATCH', 'no_event', true, 'mismatch_review', false],
      ['FAILED', null, false, 'failed', true],
      ['FAILED', 'event_after_failure', true, 'mismatch_review', false],
      ['EXPIRED', null, false, 'expired', true],
      ['EXPIRED', null, true, 'mismatch_review', false],
    ]
    for (const [st, reason, needsReview, ui, retry] of cases) {
      const record = { status: st, mismatchReason: reason, needsReview }
      expect(tipUiState(record)).toBe(ui)
      expect(tipCanRetry(record)).toBe(retry)
    }
  })
})

describe('prepareDirectTip', () => {
  it('returns everything needed to build Core.tip and stores PREPARED rows', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId, 100, 'req-shape')
    expect(prepared).toMatchObject({
      method: 'tip',
      status: 'PREPARED',
      existing: false,
      network: 'TESTNET',
      networkPassphrase: PASSPHRASE,
      chainEpoch: EPOCH,
      contractId: CORE,
      tokenContractId: TOKEN,
      tipperAddress: TIPPER,
      maxTime: Math.floor(T0 / 1000) + 300,
      totals: {
        amountCents: 100,
        grossBaseUnits: '40000000',
        grossXlm: '4',
        feeBaseUnits: '1000000',
        netBaseUnits: '39000000',
      },
    })
    expect(prepared.items).toHaveLength(1)
    const [item] = prepared.items
    expect(item).toMatchObject({
      table: 'tips',
      articleId: s.articleId,
      legacyHighlightId: null,
      authorAddress: AUTHOR,
      tipInput: {
        article_id: ARTICLE_KEY,
        amount: '40000000',
        highlight_id: null,
      },
      quote: {
        amountCents: 100,
        priceUsd: PRICE,
        priceSource: 'CoinGecko',
        priceFetchedAt: T0,
        grossBaseUnits: '40000000',
        feeBaseUnits: '1000000',
        netBaseUnits: '39000000',
        feeBps: 250,
      },
    })
    expect(item!.tipInput.client_ref).toMatch(/^[0-9a-f]{32}$/)

    const row = await t.run((ctx) => ctx.db.get(item!.tipId as Id<'tips'>))
    expect(row).toMatchObject({
      status: 'PREPARED',
      contractVersion: 'v2',
      channel: 'direct',
      requestId: 'req-shape',
      submissionId: prepared.submissionId,
      clientRef: item!.tipInput.client_ref,
      chainArticleKey: ARTICLE_KEY,
      grossBaseUnits: '40000000',
      expectedTipperAddress: TIPPER,
      expectedAuthorAddress: AUTHOR,
      tokenContractId: TOKEN,
      amountCents: 100,
      amountUsd: 1,
      quotePriceUsd: PRICE,
      quoteSource: 'CoinGecko',
      tipperId: s.readerId,
      authorId: s.authorId,
    })
  })

  it('is idempotent on requestId and refuses a reused requestId for another request', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await direct(t, s.readerId, s.articleId, 100, 'req-same')
    // Replays succeed even after the price goes stale and beyond the rate limit.
    vi.setSystemTime(T0 + PRICE_MAX_AGE_MS + 1)
    for (let i = 0; i < 12; i++) {
      const again = await direct(t, s.readerId, s.articleId, 100, 'req-same')
      expect(again).toEqual({ ...first, existing: true })
    }
    const counts = await t.run(async (ctx) => ({
      submissions: (await ctx.db.query('chainSubmissions').collect()).length,
      tips: (await ctx.db.query('tips').collect()).length,
    }))
    expect(counts).toEqual({ submissions: 1, tips: 1 })

    expect(
      await code(direct(t, s.readerId, s.articleId, 200, 'req-same'))
    ).toBe('REQUEST_CONFLICT')
    expect(
      await code(direct(t, s.reader2Id, s.articleId, 100, 'req-same'))
    ).toBe('REQUEST_CONFLICT')
    expect(await code(highlight(t, s, {}, 'req-same'))).toBe('REQUEST_CONFLICT')
  })

  it('treats a changed message on a replayed requestId as a conflict', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const reader = as(t, s.readerId)
    const send = (message?: string) =>
      reader.mutation(api.tipsV2.prepareDirectTip, {
        requestId: 'req-msg',
        articleId: s.articleId,
        amountCents: 100,
        ...(message === undefined ? {} : { message }),
      })
    const first = await send('Thank you')
    expect(await send('Thank you')).toEqual({ ...first, existing: true })
    expect(await code(send('Thanks'))).toBe('REQUEST_CONFLICT')
    expect(await code(send())).toBe('REQUEST_CONFLICT')

    // Without a message first, adding one is a conflict too.
    const plain = await direct(t, s.readerId, s.articleId, 100, 'req-plain')
    expect(await direct(t, s.readerId, s.articleId, 100, 'req-plain')).toEqual({
      ...plain,
      existing: true,
    })
    expect(
      await code(
        reader.mutation(api.tipsV2.prepareDirectTip, {
          requestId: 'req-plain',
          articleId: s.articleId,
          amountCents: 100,
          message: 'Hello',
        })
      )
    ).toBe('REQUEST_CONFLICT')
    const tips = await t.run((ctx) => ctx.db.query('tips').collect())
    expect(tips).toHaveLength(2)
  })

  it('accepts min_tip exactly and refuses min_tip − 1', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // 25 cents is exactly 10,000,000 base units at 0.25 USD per XLM.
    const ok = await direct(t, s.readerId, s.articleId, 25)
    expect(ok.items[0]!.tipInput.amount).toBe(MIN_TIP)
    const below = await errorData(direct(t, s.readerId, s.articleId, 24))
    expect(below).toMatchObject({
      code: 'BELOW_MINIMUM',
      minTipBaseUnits: MIN_TIP,
    })
    expect(below.itemIndex).toBeUndefined()
    // With min_tip one above the converted amount, the same 25 cents fail.
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.patch(config._id, { minTip: '10000001' })
    })
    expect(await code(direct(t, s.readerId, s.articleId, 25))).toBe(
      'BELOW_MINIMUM'
    )
    const above = await direct(t, s.readerId, s.articleId, 26)
    expect(above.items[0]!.tipInput.amount).toBe('10400000')
  }, 20_000)

  it('refuses a stale or missing price instead of guessing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.setSystemTime(T0 + PRICE_MAX_AGE_MS)
    await direct(t, s.readerId, s.articleId)
    vi.setSystemTime(T0 + PRICE_MAX_AGE_MS + 1)
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'PRICE_UNAVAILABLE'
    )
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('xlmPriceCache').collect()) {
        await ctx.db.delete(row._id)
      }
    })
    vi.setSystemTime(T0)
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'PRICE_UNAVAILABLE'
    )
  })

  it('refuses with a code for each eligibility rule', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)

    // Auth and the request itself.
    expect(
      await code(
        t.mutation(api.tipsV2.prepareDirectTip, {
          requestId: rid(),
          articleId: s.articleId,
          amountCents: 100,
        })
      )
    ).toBe('UNAUTHENTICATED')
    expect(await code(direct(t, s.readerId, s.articleId, 100, 'bad id!'))).toBe(
      'INVALID_PREPARE'
    )
    expect(
      await code(
        as(t, s.readerId).mutation(api.tipsV2.prepareDirectTip, {
          requestId: rid(),
          articleId: s.articleId,
          amountCents: 100,
          message: 'x'.repeat(501),
        })
      )
    ).toBe('INVALID_PREPARE')
    for (const cents of [0, -5, 1.5, 10_001]) {
      expect(await code(direct(t, s.readerId, s.articleId, cents))).toBe(
        'INVALID_AMOUNT'
      )
    }

    // Wallets.
    expect(await code(direct(t, s.noWalletId, s.articleId))).toBe('NO_WALLET')
    expect(await code(direct(t, s.unverifiedId, s.articleId))).toBe(
      'ADDRESS_UNVERIFIED'
    )

    // Article state.
    expect(await code(direct(t, s.readerId, s.draftId))).toBe(
      'ARTICLE_NOT_FOUND'
    )
    expect(await code(direct(t, s.readerId, s.unregisteredId))).toBe(
      'ARTICLE_NOT_REGISTERED'
    )

    // Self tips: owner, split recipient.
    expect(await code(direct(t, s.authorId, s.articleId))).toBe('SELF_TIP')
    expect(await code(direct(t, s.coauthorId, s.split2Id))).toBe('SELF_TIP')

    // Nothing above wrote a row.
    const rows = await t.run((ctx) => ctx.db.query('tips').collect())
    expect(rows).toHaveLength(0)
  })

  it('refuses an article registered in another epoch or not yet REGISTERED', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('CHAIN_EPOCH', 'testnet-next')
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.patch(config._id, { chainEpoch: 'testnet-next' })
    })
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'ARTICLE_NOT_REGISTERED'
    )
    vi.stubEnv('CHAIN_EPOCH', EPOCH)
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.patch(config._id, { chainEpoch: EPOCH })
      const row = (await ctx.db.query('chainArticles').first())!
      await ctx.db.patch(row._id, { status: 'SUBMITTED' })
    })
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'ARTICLE_NOT_REGISTERED'
    )
  })

  it('refuses when the on-chain author is not the owner’s verified address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // The writer moved to a new wallet in the app only.
    await t.run((ctx) =>
      ctx.db.patch(s.authorId, { stellarAddress: OTHER_AUTHOR })
    )
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'PAYOUT_ADDRESS_CHANGED'
    )
    // The same address, but no longer verified on this network.
    await t.run((ctx) =>
      ctx.db.patch(s.authorId, {
        stellarAddress: AUTHOR,
        stellarAddressVerifiedNetwork:
          'Public Global Stellar Network ; September 2015',
      })
    )
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'PAYOUT_ADDRESS_CHANGED'
    )
  })

  it('refuses when Core is paused or its config is not loaded', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.patch(config._id, { paused: { core: true } })
    })
    expect(await code(direct(t, s.readerId, s.articleId))).toBe('PAUSED')
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.patch(config._id, {
        paused: { core: false },
        coreContractId: seedAddress(1).replace(/^G/, 'C'),
      })
    })
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'CHAIN_CONFIG_MISSING'
    )
    await t.run(async (ctx) => {
      const config = (await ctx.db.query('chainConfig').first())!
      await ctx.db.delete(config._id)
    })
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'CHAIN_CONFIG_MISSING'
    )
  })

  it('does not depend on tab readiness: wallet tips stay available while the tab keys are not ready (#692)', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // A Tab contract is configured, but settlement is off and neither tab
    // secret parses: tab tips are not offered.
    vi.stubEnv('TAB_CONTRACT_ID', TOKEN)
    vi.stubEnv('SETTLEMENT_ENABLED', 'false')
    vi.stubEnv('TAB_SETTLER_SECRET', 'not-a-secret')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'not-a-secret')
    expect((await t.query(api.chain.config.getChainConfig, {})).tabReady).toBe(
      false
    )
    expect(
      (await direct(t, s.readerId, s.articleId, 100, 'req-direct-692')).status
    ).toBe('PREPARED')
    expect(
      (
        await batch(t, s.readerId, [
          { articleId: s.articleId },
          { articleId: s.articleId, highlight: true },
        ])
      ).status
    ).toBe('PREPARED')
  })

  it('is gated by CHAIN_V2_ENABLED and needs the contract IDs', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'CHAIN_V2_DISABLED'
    )
    vi.stubEnv('CHAIN_V2_ENABLED', 'true')
    vi.stubEnv('TOKEN_CONTRACT_ID', '')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing = await errorData(direct(t, s.readerId, s.articleId))
    expect(missing).toEqual({
      code: 'CHAIN_CONFIG_MISSING',
      message: 'Tipping is not configured on this deployment.',
    })
    // The variable names go to the server log only.
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('TOKEN_CONTRACT_ID')
    log.mockRestore()
    vi.stubEnv('TOKEN_CONTRACT_ID', 'not-a-contract')
    expect(await code(direct(t, s.readerId, s.articleId))).toBe(
      'CHAIN_CONFIG_INVALID'
    )
  })

  it('rate limits prepare calls per user', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    for (let i = 0; i < 10; i++) await direct(t, s.readerId, s.articleId)
    const limited = await errorData(direct(t, s.readerId, s.articleId))
    expect(limited.code).toBe('RATE_LIMITED')
    expect(limited.retryAfterMs).toBeGreaterThan(59_000)
    expect(limited.retryAfterMs).toBeLessThanOrEqual(60_000)
    // Another reader is not affected; the window reopens after a minute.
    await direct(t, s.reader2Id, s.articleId)
    vi.setSystemTime(T0 + 60_000)
    await direct(t, s.readerId, s.articleId)
  }, 30_000)
})

describe('prepareHighlightTip', () => {
  it('derives highlight_id from the shared vector and stores the legacy prefix', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const vector = vectors.identifiers.highlight_ids[0]!
    const prepared = await highlight(t, s)
    expect(prepared.method).toBe('tip')
    const [item] = prepared.items
    expect(item).toMatchObject({
      table: 'highlightTips',
      tipInput: {
        article_id: ARTICLE_KEY,
        amount: '20000000',
        highlight_id: vector.highlight_id,
      },
      legacyHighlightId: vector.v1_convex_id,
    })
    const row = await t.run((ctx) =>
      ctx.db.get(item!.tipId as Id<'highlightTips'>)
    )
    expect(row).toMatchObject({
      status: 'PREPARED',
      channel: 'direct',
      highlightId: vector.v1_convex_id,
      chainHighlightKey: vector.highlight_id,
      highlightText: HL_TEXT,
      startOffset: HL_START,
      endOffset: HL_END,
      startContainerPath: `text.${HL_START + 1}`,
      endContainerPath: `text.${HL_END + 1}`,
    })
  })

  it('refuses a passage that does not match the article', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(await code(highlight(t, s, { text: 'The slow brown fox' }))).toBe(
      'HIGHLIGHT_INVALID'
    )
    expect(
      await code(highlight(t, s, { startOffset: 5_000, endOffset: 5_010 }))
    ).toBe('HIGHLIGHT_INVALID')
    expect(await code(highlight(t, s, { text: '   ' }))).toBe(
      'HIGHLIGHT_INVALID'
    )
  })

  it('treats any changed passage field on a replayed requestId as a conflict', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const send = (
      passage: Partial<{
        text: string
        startOffset: number
        endOffset: number
        startContainerPath: string
        endContainerPath: string
      }> = {},
      message?: string
    ) =>
      as(t, s.readerId).mutation(api.tipsV2.prepareHighlightTip, {
        requestId: 'req-hl',
        articleId: s.articleId,
        amountCents: 50,
        highlight: {
          text: HL_TEXT,
          startOffset: HL_START,
          endOffset: HL_END,
          ...passage,
        },
        ...(message === undefined ? {} : { message }),
      })
    const first = await send()
    const replay = { ...first, existing: true }
    expect(await send()).toEqual(replay)
    // Container paths are hints: the canonical ones match, omitted ones match.
    expect(
      await send({
        startContainerPath: `text.${HL_START + 1}`,
        endContainerPath: `text.${HL_END + 1}`,
      })
    ).toEqual(replay)

    const shorter = 'The quick brown fox'
    const changed = [
      // One field at a time; the replay check runs before the passage check.
      { text: HL_TEXT.replace('fox', 'cat') },
      { startOffset: HL_START + 1 },
      { endOffset: HL_END - 1 },
      // Consistent passages elsewhere in the article.
      { text: shorter, endOffset: HL_START + shorter.length },
      {
        text: HL_TEXT.slice(4),
        startOffset: HL_START + 4,
      },
      { endOffset: HL_END - 1, text: HL_TEXT.slice(0, -1) },
      {
        startContainerPath: `text.${HL_START + 2}`,
        endContainerPath: `text.${HL_END + 1}`,
      },
      {
        startContainerPath: `text.${HL_START + 1}`,
        endContainerPath: `text.${HL_END + 2}`,
      },
    ]
    for (const passage of changed) {
      expect(await code(send(passage))).toBe('REQUEST_CONFLICT')
    }
    expect(await code(send({}, 'A note'))).toBe('REQUEST_CONFLICT')
    // A direct tip under the same requestId is a conflict as well.
    expect(await code(direct(t, s.readerId, s.articleId, 50, 'req-hl'))).toBe(
      'REQUEST_CONFLICT'
    )

    const rows = await t.run(async (ctx) => ({
      highlightTips: (await ctx.db.query('highlightTips').collect()).length,
      tips: (await ctx.db.query('tips').collect()).length,
      submissions: (await ctx.db.query('chainSubmissions').collect()).length,
    }))
    expect(rows).toEqual({ highlightTips: 1, tips: 0, submissions: 1 })
  })

  it('treats a changed passage in one batch item as a conflict', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const items = [
      { articleId: s.articleId },
      { articleId: s.articleId, highlight: true },
    ]
    const first = await batch(t, s.readerId, items, 'req-batch-hl')
    expect(await batch(t, s.readerId, items, 'req-batch-hl')).toEqual({
      ...first,
      existing: true,
    })
    const shorter = 'The quick brown fox'
    expect(
      await code(
        as(t, s.readerId).mutation(api.tipsV2.prepareBatch, {
          requestId: 'req-batch-hl',
          items: [
            { articleId: s.articleId, amountCents: 100 },
            {
              articleId: s.articleId,
              amountCents: 100,
              highlight: {
                text: shorter,
                startOffset: HL_START,
                endOffset: HL_START + shorter.length,
              },
            },
          ],
        })
      )
    ).toBe('REQUEST_CONFLICT')
  })
})

describe('prepareBatch', () => {
  it('prepares up to 10 items with one client_ref each and refuses 11', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const items = Array.from({ length: 10 }, (_, i) => ({
      articleId: s.articleId,
      amountCents: 100 + i,
      highlight: i === 3,
    }))
    const prepared = await batch(t, s.readerId, items)
    expect(prepared.method).toBe('tip_batch')
    expect(prepared.items).toHaveLength(10)
    const refs = new Set(prepared.items.map((i) => i.tipInput.client_ref))
    expect(refs.size).toBe(10)
    expect(prepared.items[3]!.table).toBe('highlightTips')
    expect(prepared.items[3]!.tipInput.highlight_id).toBe(
      vectors.identifiers.highlight_ids[0]!.highlight_id
    )
    const rows = await t.run((ctx) => ctx.db.query('tips').collect())
    expect(rows.every((r) => r.channel === 'batch')).toBe(true)

    const eleven = await errorData(
      batch(t, s.readerId, [...items, { articleId: s.articleId }])
    )
    expect(eleven).toMatchObject({ code: 'BATCH_TOO_LARGE', maxItems: 10 })
    expect(await code(batch(t, s.readerId, []))).toBe('BATCH_EMPTY')
  }, 20_000)

  it('counts recipients plus the fee transfer: 24 transfers pass, 25 fail', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // 3 × (5 + 1) + 3 × (1 + 1) = 24.
    const ok = await batch(t, s.readerId, [
      { articleId: s.split5Id },
      { articleId: s.split5Id },
      { articleId: s.split5Id },
      { articleId: s.articleId },
      { articleId: s.articleId },
      { articleId: s.articleId },
    ])
    expect(ok.items).toHaveLength(6)
    // 3 × (5 + 1) + (2 + 1) + 2 × (1 + 1) = 25.
    const over = await errorData(
      batch(t, s.readerId, [
        { articleId: s.split5Id },
        { articleId: s.split5Id },
        { articleId: s.split5Id },
        { articleId: s.split2Id },
        { articleId: s.articleId },
        { articleId: s.articleId },
      ])
    )
    expect(over).toMatchObject({
      code: 'BATCH_TOO_LARGE',
      transferCount: 25,
      maxTransfers: MAX_BATCH_TRANSFERS,
    })
  })

  it('names the failing item and writes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const failure = await errorData(
      batch(t, s.readerId, [
        { articleId: s.articleId },
        { articleId: s.unregisteredId },
      ])
    )
    expect(failure).toMatchObject({
      code: 'ARTICLE_NOT_REGISTERED',
      itemIndex: 1,
    })
    expect(
      await errorData(
        batch(t, s.readerId, [
          { articleId: s.articleId },
          { articleId: s.articleId, amountCents: 10 },
        ])
      )
    ).toMatchObject({ code: 'BELOW_MINIMUM', itemIndex: 1 })
    // The co-author is a recipient of split2.
    expect(
      await errorData(
        batch(t, s.coauthorId, [
          { articleId: s.articleId },
          { articleId: s.split2Id },
        ])
      )
    ).toMatchObject({ code: 'SELF_TIP', itemIndex: 1 })
    const counts = await t.run(async (ctx) => ({
      submissions: (await ctx.db.query('chainSubmissions').collect()).length,
      tips: (await ctx.db.query('tips').collect()).length,
    }))
    expect(counts).toEqual({ submissions: 0, tips: 0 })
  })
})

describe('lifecycle', () => {
  it('prepare → recordSubmitted → verification → CONFIRMED with decoded amounts', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const checking = await status(t, s, prepared)
    expect(checking).toMatchObject({
      status: 'PREPARED',
      uiState: 'checking',
      canRetry: false,
      txHash: null,
      chainTotals: null,
    })
    const done = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[eventFor(prepared, 0)]])
    )
    expect(done).toMatchObject({
      submissionId: prepared.submissionId,
      method: 'tip',
      status: 'CONFIRMED',
      uiState: 'confirmed',
      canRetry: false,
      needsReview: false,
      txHash: HASH,
      ledger: 6_000_000,
      chainTotals: {
        grossBaseUnits: '40000000',
        feeBaseUnits: '1000000',
        netBaseUnits: '39000000',
      },
    })
    expect(done.items[0]).toMatchObject({
      status: 'CONFIRMED',
      uiState: 'confirmed',
      preparedBaseUnits: '40000000',
      expectedAuthorAddress: AUTHOR,
      chain: {
        grossBaseUnits: '40000000',
        feeBaseUnits: '1000000',
        netBaseUnits: '39000000',
        authorAddress: AUTHOR,
        tipperAddress: TIPPER,
        tokenContractId: TOKEN,
        contentVersion: 1,
      },
    })
    // The same status by tip ID.
    expect(
      await as(t, s.readerId).query(api.tipsV2.getTipStatus, {
        tipId: prepared.items[0]!.tipId,
      })
    ).toEqual(done)
    // Nobody else sees it.
    expect(
      await as(t, s.reader2Id).query(api.tipsV2.getTipStatus, {
        submissionId: prepared.submissionId,
      })
    ).toBeNull()
    expect(
      await t.query(api.tipsV2.getTipStatus, {
        submissionId: prepared.submissionId,
      })
    ).toBeNull()
  })

  it('a highlight tip confirms with the expected highlight_id', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await highlight(t, s)
    const done = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[eventFor(prepared, 0)]])
    )
    expect(done.uiState).toBe('confirmed')
    const other = await highlight(t, s)
    const wrong = await submitAndVerify(
      t,
      s,
      other,
      () =>
        successResponse(HASH2, [
          [eventFor(other, 0, { highlightId: 'ee'.repeat(32) })],
        ]),
      HASH2
    )
    expect(wrong).toMatchObject({
      status: 'MISMATCH',
      uiState: 'mismatch_review',
      mismatchReason: 'field:highlight_id',
      canRetry: false,
    })
  })

  it('MISMATCH author: paid to the on-chain author, no retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const result = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[eventFor(prepared, 0, { author: OTHER_AUTHOR })]])
    )
    expect(result).toMatchObject({
      status: 'MISMATCH',
      uiState: 'mismatch_author',
      mismatchReason: 'author',
      needsReview: false,
      canRetry: false,
    })
    expect(result.items[0]!.chain?.authorAddress).toBe(OTHER_AUTHOR)
  })

  it.each([
    ['field:gross', { gross: BigInt(40_000_001) }],
    ['field:tipper', { tipper: OTHER_AUTHOR }],
    ['field:fee', { fee: BigInt(1) }],
  ])(
    'MISMATCH %s needs review and never offers a retry',
    async (reason, overrides) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const prepared = await direct(t, s.readerId, s.articleId)
      const result = await submitAndVerify(t, s, prepared, () =>
        successResponse(HASH, [[eventFor(prepared, 0, overrides)]])
      )
      expect(result).toMatchObject({
        status: 'MISMATCH',
        uiState: 'mismatch_review',
        mismatchReason: reason,
        needsReview: true,
        canRetry: false,
      })
    }
  )

  it('reports amounts from the chain event when they differ from prepare', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    expect(prepared.items[0]!.tipInput.amount).toBe('40000000')
    const gross = BigInt(39_999_999)
    const fee = (gross * BigInt(250)) / BigInt(10_000)
    const result = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[eventFor(prepared, 0, { gross })]])
    )
    expect(result).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:gross',
      canRetry: false,
    })
    const [item] = result.items
    expect(item!.preparedBaseUnits).toBe('40000000')
    expect(item!.chain).toMatchObject({
      grossBaseUnits: gross.toString(),
      feeBaseUnits: fee.toString(),
      netBaseUnits: (gross - fee).toString(),
    })
    expect(result.chainTotals).toEqual({
      grossBaseUnits: gross.toString(),
      feeBaseUnits: fee.toString(),
      netBaseUnits: (gross - fee).toString(),
    })
  })

  it('MISMATCH no_event: a SUCCESS transaction without the event never fails', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const result = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[]])
    )
    expect(result).toMatchObject({
      status: 'MISMATCH',
      uiState: 'mismatch_review',
      mismatchReason: 'no_event',
      needsReview: true,
      canRetry: false,
      chainTotals: null,
    })
  })

  it('FAILED on chain offers a retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const result = await submitAndVerify(t, s, prepared, () =>
      failedResponse(HASH)
    )
    expect(result).toMatchObject({
      status: 'FAILED',
      uiState: 'failed',
      canRetry: true,
    })
    expect(result.items[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'transaction_failed',
    })
  })

  it('recordSendFailed marks an unsent tip FAILED, once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const reader = as(t, s.readerId)
    expect(
      await code(
        as(t, s.reader2Id).mutation(api.tipsV2.recordSendFailed, {
          submissionId: prepared.submissionId,
          reason: 'send_error',
        })
      )
    ).toBe('NOT_FOUND')
    expect(
      await reader.mutation(api.tipsV2.recordSendFailed, {
        tipId: prepared.items[0]!.tipId,
        reason: 'simulation_failed',
        detail: 'Error(Contract, #8)',
      })
    ).toEqual({ submissionId: prepared.submissionId, status: 'FAILED' })
    const result = await status(t, s, prepared)
    expect(result).toMatchObject({ uiState: 'failed', canRetry: true })
    expect(result.items[0]!.failureReason).toBe(
      'simulation_failed: Error(Contract, #8)'
    )
    expect(
      await code(
        reader.mutation(api.tipsV2.recordSendFailed, {
          submissionId: prepared.submissionId,
          reason: 'send_error',
        })
      )
    ).toBe('INVALID_STATE')

    // A wallet refusal is a failure before sending, with a retry.
    const refused = await direct(t, s.readerId, s.articleId)
    await reader.mutation(api.tipsV2.recordSendFailed, {
      submissionId: refused.submissionId,
      reason: 'wallet_rejected',
    })
    const refusedStatus = await status(t, s, refused)
    expect(refusedStatus).toMatchObject({ uiState: 'failed', canRetry: true })
    expect(refusedStatus.items[0]!.failureReason).toBe('wallet_rejected')

    // The reason is forwarded as-is, with the detail after it.
    const refusedWithDetail = await direct(t, s.readerId, s.articleId)
    await reader.mutation(api.tipsV2.recordSendFailed, {
      tipId: refusedWithDetail.items[0]!.tipId,
      reason: 'wallet_rejected',
      detail: 'User declined',
    })
    const detailStatus = await status(t, s, refusedWithDetail)
    expect(detailStatus).toMatchObject({ uiState: 'failed', canRetry: true })
    expect(detailStatus.items[0]!.failureReason).toBe(
      'wallet_rejected: User declined'
    )
  })

  it('EXPIRED after the indexer covers maxTime offers a retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    stubRpc(() => notFoundResponse(HASH))
    await as(t, s.readerId).mutation(api.tipsV2.recordSubmitted, {
      submissionId: prepared.submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.setSystemTime((prepared.maxTime + 601) * 1000)
    await setCursor(t, prepared.maxTime - 5)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await status(t, s, prepared)).uiState).toBe('checking')
    await setCursor(t, prepared.maxTime + EXPIRY_COVERAGE_MARGIN_SECONDS)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(await status(t, s, prepared)).toMatchObject({
      status: 'EXPIRED',
      uiState: 'expired',
      canRetry: true,
    })
  })

  it('a batch confirms per item, matched by client_ref, under one hash', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await batch(t, s.readerId, [
      { articleId: s.articleId, amountCents: 100 },
      { articleId: s.articleId, amountCents: 50, highlight: true },
      { articleId: s.split2Id, amountCents: 30 },
    ])
    const done = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [
        // Events in a different order than the items.
        [eventFor(prepared, 2), eventFor(prepared, 0), eventFor(prepared, 1)],
      ])
    )
    expect(done).toMatchObject({
      method: 'tip_batch',
      status: 'CONFIRMED',
      uiState: 'confirmed',
      txHash: HASH,
    })
    expect(done.items.map((i) => i.status)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
    ])
    const grosses = prepared.items.map((i) => BigInt(i.tipInput.amount))
    const gross = grosses.reduce((a, b) => a + b, BigInt(0))
    const fee = grosses.reduce((a, b) => a + feeOf(b), BigInt(0))
    expect(done.chainTotals).toEqual({
      grossBaseUnits: gross.toString(),
      feeBaseUnits: fee.toString(),
      netBaseUnits: (gross - fee).toString(),
    })
    // Any item's tip ID finds the batch.
    expect(
      await as(t, s.readerId).query(api.tipsV2.getTipStatus, {
        tipId: prepared.items[2]!.tipId,
      })
    ).toEqual(done)
  })

  it('a batch with one missing event is MISMATCH as a whole and offers no retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await batch(t, s.readerId, [
      { articleId: s.articleId },
      { articleId: s.articleId },
    ])
    const result = await submitAndVerify(t, s, prepared, () =>
      successResponse(HASH, [[eventFor(prepared, 0)]])
    )
    expect(result).toMatchObject({
      status: 'MISMATCH',
      uiState: 'mismatch_review',
      canRetry: false,
    })
    expect(result.items.map((i) => [i.status, i.mismatchReason])).toEqual([
      ['CONFIRMED', null],
      ['MISMATCH', 'no_event'],
    ])
  })

  it('accepts a (txHash, clientRef) pair once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    const other = await direct(t, s.readerId, s.articleId)
    stubRpc(() => notFoundResponse(HASH))
    const reader = as(t, s.readerId)
    expect(
      await reader.mutation(api.tipsV2.recordSubmitted, {
        submissionId: prepared.submissionId,
        txHash: HASH,
      })
    ).toMatchObject({ status: 'SUBMITTED', duplicate: false })
    // The same pair again (a DUPLICATE send status) is a no-op.
    expect(
      await reader.mutation(api.tipsV2.recordSubmitted, {
        tipId: prepared.items[0]!.tipId,
        txHash: HASH.toUpperCase(),
      })
    ).toEqual({
      submissionId: prepared.submissionId,
      status: 'SUBMITTED',
      duplicate: true,
    })
    // Another hash for the same record, and the same hash for another record.
    expect(
      await code(
        reader.mutation(api.tipsV2.recordSubmitted, {
          submissionId: prepared.submissionId,
          txHash: HASH2,
        })
      )
    ).toBe('INVALID_STATE')
    expect(
      await code(
        reader.mutation(api.tipsV2.recordSubmitted, {
          submissionId: other.submissionId,
          txHash: HASH,
        })
      )
    ).toBe('DUPLICATE_TX')
    expect(
      await code(
        reader.mutation(api.tipsV2.recordSubmitted, {
          submissionId: other.submissionId,
          txHash: 'nothex',
        })
      )
    ).toBe('INVALID_TX_HASH')
    const rows = await t.run((ctx) => ctx.db.query('tips').collect())
    expect(rows.filter((r) => r.stellarTxId === HASH)).toHaveLength(1)
  })

  it('rate limits record calls per user; a repeat with the stored hash is free', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    stubRpc(() => notFoundResponse(HASH))
    const reader = as(t, s.readerId)
    const key = `tipsV2:record:${s.readerId}`
    const counted = () =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('rateLimits')
              .withIndex('by_key', (q) => q.eq('key', key))
              .unique()
          )?.count ?? 0
      )

    // A batch of 10 is one record call; repeats of the stored hash are free.
    const items = Array.from({ length: 10 }, () => ({ articleId: s.articleId }))
    const big = await batch(t, s.readerId, items)
    await reader.mutation(api.tipsV2.recordSubmitted, {
      submissionId: big.submissionId,
      txHash: HASH,
    })
    for (let i = 0; i < 5; i++) {
      const again = await reader.mutation(api.tipsV2.recordSubmitted, {
        tipId: big.items[i]!.tipId,
        txHash: HASH.toUpperCase(),
      })
      expect(again.duplicate).toBe(true)
    }
    expect(await counted()).toBe(1)
    const failed = await direct(t, s.readerId, s.articleId)
    await reader.mutation(api.tipsV2.recordSendFailed, {
      submissionId: failed.submissionId,
      reason: 'wallet_rejected',
    })
    expect(await counted()).toBe(2)

    // At the limit, both record calls are refused and write nothing.
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query('rateLimits')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique())!
      await ctx.db.patch(row._id, { count: RECORD_RATE_LIMIT })
    })
    const pending = await direct(t, s.readerId, s.articleId)
    const limited = await errorData(
      reader.mutation(api.tipsV2.recordSendFailed, {
        submissionId: pending.submissionId,
        reason: 'simulation_failed',
      })
    )
    expect(limited.code).toBe('RATE_LIMITED')
    expect(limited.retryAfterMs).toBeGreaterThan(0)
    expect(limited.retryAfterMs).toBeLessThanOrEqual(RECORD_RATE_WINDOW_MS)
    expect(
      await code(
        reader.mutation(api.tipsV2.recordSubmitted, {
          submissionId: pending.submissionId,
          txHash: HASH2,
        })
      )
    ).toBe('RATE_LIMITED')
    expect((await status(t, s, pending)).status).toBe('PREPARED')
    expect(await counted()).toBe(RECORD_RATE_LIMIT)
    // The stored hash still answers, and another user is not affected.
    expect(
      (
        await reader.mutation(api.tipsV2.recordSubmitted, {
          submissionId: big.submissionId,
          txHash: HASH,
        })
      ).duplicate
    ).toBe(true)
    const other = await direct(t, s.reader2Id, s.articleId)
    await as(t, s.reader2Id).mutation(api.tipsV2.recordSendFailed, {
      submissionId: other.submissionId,
      reason: 'send_error',
    })

    // The window reopens.
    const windowStart = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('rateLimits')
          .withIndex('by_key', (q) => q.eq('key', key))
          .unique())!.windowStart
    )
    vi.setSystemTime(windowStart + RECORD_RATE_WINDOW_MS)
    await reader.mutation(api.tipsV2.recordSubmitted, {
      submissionId: pending.submissionId,
      txHash: HASH2,
    })
    expect((await status(t, s, pending)).status).toBe('SUBMITTED')
  }, 30_000)

  it('records only the caller’s own tip submissions', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const prepared = await direct(t, s.readerId, s.articleId)
    expect(
      await code(
        as(t, s.reader2Id).mutation(api.tipsV2.recordSubmitted, {
          submissionId: prepared.submissionId,
          txHash: HASH,
        })
      )
    ).toBe('NOT_FOUND')
    expect(
      await code(
        t.mutation(api.tipsV2.recordSubmitted, {
          submissionId: prepared.submissionId,
          txHash: HASH,
        })
      )
    ).toBe('UNAUTHENTICATED')
    // A non-tip submission of the same user is not a tip.
    const registerId = await t.run((ctx) =>
      ctx.db.insert('chainSubmissions', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        kind: 'register',
        userId: s.readerId,
        contractId: CORE,
        requestId: 'register-1',
        clientRefs: [],
        maxTime: Math.floor(T0 / 1000) + 300,
        status: 'PREPARED',
        attempts: 0,
        related: [],
        createdAt: T0,
        updatedAt: T0,
      })
    )
    expect(
      await code(
        as(t, s.readerId).mutation(api.tipsV2.recordSubmitted, {
          submissionId: registerId,
          txHash: HASH,
        })
      )
    ).toBe('NOT_FOUND')
    expect(
      await as(t, s.readerId).query(api.tipsV2.getTipStatus, {
        submissionId: registerId,
      })
    ).toBeNull()
    // A prepare reusing that requestId is a conflict, not the register record.
    expect(
      await code(direct(t, s.readerId, s.articleId, 100, 'register-1'))
    ).toBe('REQUEST_CONFLICT')
  })
})

describe('getTipEligibility', () => {
  it('reports article checks to anyone and account checks to the caller', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const anon = await t.query(api.tipsV2.getTipEligibility, {
      articleId: s.articleId,
    })
    expect(anon).toMatchObject({
      eligible: false,
      reason: 'UNAUTHENTICATED',
      articleKey: ARTICLE_KEY,
      authorAddress: AUTHOR,
      recipientCount: 1,
      transferCount: 2,
      maxBatchItems: 10,
      maxBatchTransfers: 24,
      minTipBaseUnits: MIN_TIP,
      minTipCents: 25,
      price: { priceUsd: PRICE, source: 'CoinGecko', fetchedAt: T0 },
    })
    expect(
      await as(t, s.readerId).query(api.tipsV2.getTipEligibility, {
        articleId: s.split5Id,
      })
    ).toMatchObject({
      eligible: true,
      reason: null,
      recipientCount: 5,
      transferCount: 6,
      tipperAddress: TIPPER,
    })
    const cases: Array<[Id<'users'> | null, Id<'articles'>, string]> = [
      [s.readerId, s.unregisteredId, 'ARTICLE_NOT_REGISTERED'],
      [s.readerId, s.draftId, 'ARTICLE_NOT_FOUND'],
      [s.authorId, s.articleId, 'SELF_TIP'],
      [s.noWalletId, s.articleId, 'NO_WALLET'],
      [s.unverifiedId, s.articleId, 'ADDRESS_UNVERIFIED'],
    ]
    for (const [userId, articleId, reason] of cases) {
      const result = userId
        ? await as(t, userId).query(api.tipsV2.getTipEligibility, {
            articleId,
          })
        : await t.query(api.tipsV2.getTipEligibility, { articleId })
      expect(result.reason).toBe(reason)
    }
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect(
      (
        await as(t, s.readerId).query(api.tipsV2.getTipEligibility, {
          articleId: s.articleId,
        })
      ).reason
    ).toBe('CHAIN_V2_DISABLED')
  })
})
