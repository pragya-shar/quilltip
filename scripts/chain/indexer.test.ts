/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeToScVal } from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import {
  LAG_ALERT_LEDGERS,
  RETENTION_ALERT_LEDGERS,
  cursorStatus,
} from '../../convex/lib/chain/indexerStore'
import { prepareTipSubmission } from '../../convex/lib/chain/submissionStore'
import { articleIdHex, articleRefHex } from '../../convex/lib/chain/ids'
import { acquireLease } from '../../convex/lib/chain/lease'
import {
  isMissingContractError,
  ledgerOfCursor,
} from '../../convex/chain/indexer'
import { fakeRpcFetch, seedAddress } from './fixtures'
import {
  SNAPSHOT_CORE,
  SNAPSHOT_TOKEN,
  coreEventJson,
  coreRpcEvent,
  rpcEventId,
  setData,
  setTopic,
} from './coreEvents'

import { expectRedispatchChangesNothing } from './redispatch'
const modules = import.meta.glob('../../convex/**/*.ts')

const START = 6_000_000
/**
 * Core derives `article_id` from the registering author and the app's
 * `article_ref` (#479). `seedArticle` sets both from the seeded article.
 */
let ARTICLE_REF = 'ab'.repeat(32)
let ARTICLE_KEY = 'ab'.repeat(32)
const TIPPER = seedAddress(31)
const AUTHOR = seedAddress(32)
const NEW_AUTHOR = seedAddress(33)
const T0 = Date.UTC(2026, 11, 2, 12, 0, 0)
/** Ledger START + 100 closes at T0; ledgers close every 5 seconds. */
const closeTime = (ledger: number) =>
  Math.floor(T0 / 1000) + (ledger - (START + 100)) * 5

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: 'testnet-idx',
    CORE_CONTRACT_ID: SNAPSHOT_CORE,
    TOKEN_CONTRACT_ID: SNAPSHOT_TOKEN,
    INDEXER_START_LEDGER: String(START),
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type T = ReturnType<typeof convexTest>

/**
 * An in-memory RPC: `getEvents` pages by event id like Stellar RPC (a full
 * page's cursor is its last id; a short page's cursor ends the scan window), `getHealth` reports the ledger window, and
 * `simulateTransaction` answers the Core `fee_bps` view.
 */
function fakeChain() {
  const state = {
    events: [] as RawRpcEvent[],
    latestLedger: START + 100,
    oldestLedger: START - 1_000,
    contractMissing: false,
    failGetEventsAfter: Infinity,
    getEventsCalls: 0,
    reorderPages: false,
    /** Stellar RPC scans at most this many ledgers per getEvents call. */
    scanLimit: 10_000,
  }
  const fetch = fakeRpcFetch((method, params) => {
    if (method === 'getHealth') {
      return {
        status: 'healthy',
        latestLedger: state.latestLedger,
        latestLedgerCloseTime: String(closeTime(state.latestLedger)),
        oldestLedger: state.oldestLedger,
        oldestLedgerCloseTime: '1795000000',
        ledgerRetentionWindow: 120960,
      }
    }
    if (method === 'simulateTransaction') {
      return state.contractMissing
        ? {
            latestLedger: state.latestLedger,
            error: 'HostError: Error(Storage, MissingValue)',
          }
        : {
            latestLedger: state.latestLedger,
            results: [
              { xdr: nativeToScVal(250, { type: 'u32' }).toXdr('base64') },
            ],
          }
    }
    if (method === 'getEvents') {
      state.getEventsCalls++
      if (state.getEventsCalls > state.failGetEventsAfter) {
        return { httpStatus: 503 }
      }
      const p = params as {
        startLedger?: number
        pagination?: { cursor?: string; limit?: number }
        filters: Array<{ contractIds?: string[] }>
      }
      const ids = new Set(p.filters.flatMap((f) => f.contractIds ?? []))
      const limit = p.pagination?.limit ?? 100
      const sorted = [...state.events]
        .filter((e) => ids.has(e.contractId))
        .filter((e) => e.ledger <= state.latestLedger)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
      const after = p.pagination?.cursor
      // Like Stellar RPC: scan from the cursor's ledger (or startLedger) for
      // at most scanLimit ledgers. A full page's cursor is its last event id;
      // a short page's cursor marks the last ledger of the scan window.
      const start = after
        ? Number(BigInt(after.split('-')[0]!) >> BigInt(32))
        : (p.startLedger ?? 0)
      const end = Math.min(start + state.scanLimit, state.latestLedger + 1)
      const page = sorted
        .filter((e) => e.ledger >= start && e.ledger < end)
        .filter((e) => (after ? e.id > after : true))
        .slice(0, limit)
      const cursor =
        page.length === limit
          ? page[page.length - 1]!.id
          : rpcEventId(end - 1, 0xfffff, 0xfff, 4294967295)
      return {
        events: state.reorderPages ? [...page].reverse() : page,
        cursor,
        latestLedger: state.latestLedger,
        latestLedgerCloseTime: String(closeTime(state.latestLedger)),
        oldestLedger: state.oldestLedger,
        oldestLedgerCloseTime: '1795000000',
      }
    }
    throw new Error(`unexpected RPC ${method}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { state, fetch }
}

function tippedEvent(
  ledger: number,
  options: {
    clientRef?: string
    tipper?: string
    author?: string
    gross?: bigint
    totalAfter?: bigint
    index?: number
    tx?: number
    txHash?: string
  } = {}
) {
  const json = coreEventJson('tipped')
  const gross = options.gross ?? BigInt(10_000_000)
  const fee = (gross * BigInt(250)) / BigInt(10_000)
  setTopic(json, 1, { bytes: ARTICLE_KEY })
  setTopic(json, 2, { address: options.author ?? AUTHOR })
  setData(json, 'tipper', { address: options.tipper ?? TIPPER })
  setData(json, 'token', { address: SNAPSHOT_TOKEN })
  setData(json, 'gross', { i128: gross.toString() })
  setData(json, 'fee', { i128: fee.toString() })
  setData(json, 'net', { i128: (gross - fee).toString() })
  setData(json, 'highlight_id', 'void')
  setData(json, 'client_ref', { bytes: options.clientRef ?? '7'.repeat(32) })
  setData(json, 'total_after', {
    i128: (options.totalAfter ?? gross).toString(),
  })
  return coreRpcEvent(json, {
    ledger,
    closeTime: closeTime(ledger),
    tx: options.tx,
    index: options.index,
    txHash: options.txHash,
  })
}

async function seedArticle(t: T) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: AUTHOR,
      createdAt: now,
      updatedAt: now,
    })
    const readerId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      stellarAddress: TIPPER,
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
    ARTICLE_REF = await articleRefHex(articleId)
    ARTICLE_KEY = await articleIdHex(AUTHOR, ARTICLE_REF)
    const chainArticleId = await db.insert('chainArticles', {
      network: 'TESTNET',
      chainEpoch: 'testnet-idx',
      articleId,
      articleKey: ARTICLE_KEY,
      authorAddress: AUTHOR,
      contentHash: '00'.repeat(32),
      contentVersion: 1,
      splits: [],
      totals: {},
      status: 'SUBMITTED',
      updatedAt: now,
    })
    return { authorId, readerId, articleId, chainArticleId }
  })
}

async function prepareTip(
  t: T,
  readerId: Id<'users'>,
  articleId: Id<'articles'>,
  authorId: Id<'users'>
) {
  return t.run((ctx) =>
    prepareTipSubmission(ctx, {
      userId: readerId,
      requestId: `req-${Math.random().toString(36).slice(2)}`,
      tipperAddress: TIPPER,
      items: [
        {
          table: 'tips',
          fields: {
            articleId,
            tipperId: readerId,
            authorId,
            articleTitle: 'Words',
            articleSlug: 'words',
            amountUsd: 2.5,
            amountCents: 250,
          },
          articleKey: ARTICLE_KEY,
          authorAddress: AUTHOR,
          grossBaseUnits: '10000000',
        },
      ],
      now: Date.now(),
    })
  )
}

const poll = (t: T, args: { pageLimit?: number; maxPages?: number } = {}) =>
  t.action(internal.chain.indexer.pollEvents, args)

async function cursor(t: T) {
  return t.run((ctx) => ctx.db.query('chainCursor').first())
}

async function events(t: T) {
  return t.run((ctx) => ctx.db.query('chainEvents').collect())
}

describe('event decoding from the Core contract snapshots', () => {
  it.each([
    'tipped',
    'article_registered',
    'author_proposed',
    'author_proposal_cancelled',
    'author_changed',
    'token_set',
    'treasury_set',
    'content_updated',
    'splits_set',
  ])('stores a %s event with its name and JSON-safe data', async (name) => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = [
      coreRpcEvent(coreEventJson(name), { ledger: START + 1 }),
    ]
    await poll(t)
    const [stored] = await events(t)
    expect(stored).toMatchObject({ type: name, contractId: SNAPSHOT_CORE })
    expect(JSON.stringify(stored!.data)).not.toContain('"n"')
  })
})

describe('paging and the cursor', () => {
  it('reads the ledger from an RPC paging cursor', () => {
    expect(ledgerOfCursor(rpcEventId(START + 7, 3, 1, 4))).toBe(START + 7)
    expect(ledgerOfCursor('not-a-cursor')).toBeNull()
  })

  it('an event id seen in an earlier chain epoch is a new event', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    const event = tippedEvent(START + 5, { clientRef: 'c'.repeat(32) })
    chain.state.events = [event]
    // The same id stored by a previous testnet (before a reset).
    await t.run((ctx) =>
      ctx.db.insert('chainEvents', {
        network: 'TESTNET',
        chainEpoch: 'testnet-before-reset',
        eventId: event.id,
        contractId: event.contractId,
        ledger: event.ledger,
        ledgerCloseTime: 0,
        txHash: event.txHash,
        type: 'tipped',
        topics: [],
        data: null,
        handled: 'orphan',
      })
    )
    expect(await poll(t)).toMatchObject({ stored: 1, duplicates: 0 })
    expect(
      (await events(t)).filter((e) => e.chainEpoch === 'testnet-idx')
    ).toHaveLength(1)
  })

  it('claims coverage only when the RPC scan window reached the latest ledger', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    // RPC scans at most scanLimit ledgers per call; the second event lies
    // beyond the first window.
    chain.state.latestLedger = START + 25_000
    chain.state.events = [
      tippedEvent(START + 5, { clientRef: 'a'.repeat(32) }),
      tippedEvent(START + 15_000, { clientRef: 'b'.repeat(32) }),
    ]
    await poll(t, { maxPages: 1 })
    // One short page ending at START + 9,999 is not coverage of the latest
    // ledger, so nothing up to START + 25,000 may be treated as read.
    expect((await cursor(t))!.lastLedger).toBe(0)
    expect(await events(t)).toHaveLength(1)

    const next = await poll(t)
    expect(next).toMatchObject({ status: 'ok', lastLedger: START + 25_000 })
    expect((await cursor(t))!.lastLedger).toBe(START + 25_000)
    expect(await events(t)).toHaveLength(2)
  })

  it('reads every page, resumes from the stored cursor and covers the latest ledger', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = Array.from({ length: 7 }, (_, i) =>
      tippedEvent(START + 1 + i, {
        clientRef: (i + 10).toString(16).padStart(32, '0'),
      })
    )
    const first = await poll(t, { pageLimit: 3, maxPages: 2 })
    expect(first).toMatchObject({ status: 'ok', pages: 2, stored: 6 })
    // Two full pages: every event stored, but coverage is not claimed yet.
    let c = await cursor(t)
    expect(c).toMatchObject({
      lastLedger: 0,
      cursor: chain.state.events[5]!.id,
    })

    chain.state.events.push(
      tippedEvent(START + 50, { clientRef: 'f'.repeat(32) })
    )
    const second = await poll(t, { pageLimit: 3, maxPages: 5 })
    expect(second).toMatchObject({
      status: 'ok',
      stored: 2,
      lastLedger: START + 100,
    })
    c = await cursor(t)
    expect(c).toMatchObject({
      lastLedger: START + 100,
      status: 'OK',
      lagLedgers: 0,
      chainEpoch: 'testnet-idx',
    })
    expect(await events(t)).toHaveLength(8)
    // The second run continued from the saved cursor, not the start ledger.
    const calls = chain.fetch.calls.filter(
      (call) => call.method === 'getEvents'
    )
    expect(calls[2]!.params).toMatchObject({
      pagination: { cursor: chain.state.events[5]!.id, limit: 3 },
    })
  })

  it('stores a duplicate delivery once and dispatches it once', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    const event = tippedEvent(START + 1, { totalAfter: BigInt(10_000_000) })
    chain.state.events = [event]
    await poll(t)
    // RPC delivers the same event again through a replay.
    await t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START })
    const replay = await poll(t)
    expect(replay).toMatchObject({ status: 'ok', stored: 0, duplicates: 1 })
    expect(await events(t)).toHaveLength(1)
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.totals[SNAPSHOT_TOKEN]).toBe('10000000')
  })

  it('a replayed range changes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    const registered = coreEventJson('article_registered')
    setTopic(registered, 1, { bytes: ARTICLE_KEY })
    setTopic(registered, 2, { address: AUTHOR })
    setData(registered, 'article_ref', { bytes: ARTICLE_REF })
    chain.state.events = [
      coreRpcEvent(registered, { ledger: START + 1 }),
      tippedEvent(START + 2, { totalAfter: BigInt(10_000_000) }),
    ]
    await poll(t)
    const snapshot = async () =>
      t.run(async (ctx) => ({
        events: await ctx.db.query('chainEvents').collect(),
        article: await ctx.db.get(s.chainArticleId),
      }))
    const before = await snapshot()
    await t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START })
    await poll(t)
    const after = await snapshot()
    expect(after.events).toEqual(before.events)
    expect({ ...after.article, updatedAt: 0 }).toEqual({
      ...before.article,
      updatedAt: 0,
    })
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
  })

  it('a page delivered out of order applies article events in event order', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    chain.state.reorderPages = true
    const proposed = coreEventJson('author_proposed')
    setTopic(proposed, 1, { bytes: ARTICLE_KEY })
    setData(proposed, 'new_author', { address: NEW_AUTHOR })
    const changed = coreEventJson('author_changed')
    setTopic(changed, 1, { bytes: ARTICLE_KEY })
    setData(changed, 'previous', { address: AUTHOR })
    setData(changed, 'new', { address: NEW_AUTHOR })
    chain.state.events = [
      coreRpcEvent(proposed, { ledger: START + 1 }),
      coreRpcEvent(changed, { ledger: START + 2 }),
    ]
    await poll(t)
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    // The newer author change wins even though it arrived first.
    expect(article).toMatchObject({ authorAddress: NEW_AUTHOR })
    expect(article!.pendingAuthor).toBeUndefined()
  })

  it('an older page never moves the cursor back', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = [tippedEvent(START + 1)]
    await poll(t)
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
    // A lagging RPC node answers with an older latest ledger.
    chain.state.latestLedger = START + 90
    await t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START })
    await poll(t)
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
  })

  it('a crash between pages keeps the first page and its cursor, and the rerun continues', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = Array.from({ length: 5 }, (_, i) =>
      tippedEvent(START + 1 + i, {
        clientRef: (i + 1).toString(16).padStart(32, '0'),
      })
    )
    chain.state.failGetEventsAfter = 1
    const crashed = await poll(t, { pageLimit: 2 })
    expect(crashed).toEqual({ status: 'skipped', reason: 'rpc_error' })
    let c = await cursor(t)
    expect(c).toMatchObject({ cursor: chain.state.events[1]!.id })
    expect(c!.lastError).toContain('HTTP 503')
    expect(await events(t)).toHaveLength(2)

    chain.state.failGetEventsAfter = Infinity
    await poll(t, { pageLimit: 2 })
    expect(await events(t)).toHaveLength(5)
    c = await cursor(t)
    expect(c!.lastLedger).toBe(START + 100)
  })

  it('events stored without a cursor save (a crash inside a page) are not dispatched twice', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    const event = tippedEvent(START + 1, { totalAfter: BigInt(10_000_000) })
    chain.state.events = [event]
    // A chunk was stored by a run that then died before its last chunk.
    await t.run((ctx) =>
      acquireLease(ctx, {
        name: 'indexer',
        holder: 'crashed-run',
        ttlMs: 1_000,
        now: Date.now(),
        network: 'TESTNET',
        chainEpoch: 'testnet-idx',
      })
    )
    await t.mutation(internal.chain.indexer.ingestPage, {
      holder: 'crashed-run',
      events: [event],
    })
    expect(await cursor(t)).toBeNull()
    vi.advanceTimersByTime(2_000)
    const rerun = await poll(t)
    expect(rerun).toMatchObject({ status: 'ok', stored: 0, duplicates: 1 })
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.totals[SNAPSHOT_TOKEN]).toBe('10000000')
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
  })

  it('two concurrent runs: one indexes, the other skips, and a stale holder cannot write', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = [tippedEvent(START + 1)]
    const results = await Promise.all([poll(t), poll(t)])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual(['ok', 'skipped'])
    expect(results.find((r) => r.status === 'skipped')).toEqual({
      status: 'skipped',
      reason: 'lease_held',
    })
    expect(await events(t)).toHaveLength(1)
    await expect(
      t.mutation(internal.chain.indexer.ingestPage, {
        holder: 'not-the-holder',
        events: [tippedEvent(START + 3, { clientRef: 'e'.repeat(32) })],
        cursor: {
          cursor: 'x',
          coveredLedger: 1,
          latestLedger: 1,
          oldestLedger: 1,
        },
      })
    ).rejects.toThrow(/lease/i)
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
  })

  it('skips events of failed calls and of other contracts', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = [
      { ...tippedEvent(START + 1), inSuccessfulContractCall: false },
      tippedEvent(START + 2, { clientRef: 'a'.repeat(32) }),
    ]
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        {
          ...tippedEvent(START + 3, { clientRef: 'b'.repeat(32) }),
          contractId: SNAPSHOT_TOKEN,
        },
      ],
    })
    await poll(t)
    expect((await events(t)).map((e) => e.ledger)).toEqual([START + 2])
  })
})

describe('reconciliation from events', () => {
  it('confirms a submitted tip from its Tipped event (rule (b))', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const prepared = await prepareTip(t, s.readerId, s.articleId, s.authorId)
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 1, {
        clientRef: prepared.clientRefs[0],
        totalAfter: BigInt(30_000_000),
      }),
    ]
    await poll(t)
    const sub = await t.run((ctx) => ctx.db.get(prepared.submissionId))
    expect(sub).toMatchObject({ status: 'CONFIRMED' })
    const [stored] = await events(t)
    expect(stored).toMatchObject({
      handled: 'done',
      clientRef: prepared.clientRefs[0],
    })
    const tip = await t.run((ctx) =>
      ctx.db.get(prepared.related[0]!.id as Id<'tips'>)
    )
    expect(tip).toMatchObject({
      status: 'CONFIRMED',
      chainEventId: stored!.eventId,
      netBaseUnits: '9750000',
    })
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.totals[SNAPSHOT_TOKEN]).toBe('30000000')
    await expectRedispatchChangesNothing(t)
  })

  it('a Tipped event for an unknown client_ref is an orphan that still counts in article totals', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 1, { totalAfter: BigInt(55_000_000) }),
    ]
    await poll(t)
    const [stored] = await events(t)
    expect(stored!.handled).toBe('orphan')
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.totals[SNAPSHOT_TOKEN]).toBe('55000000')
  })

  it('totals never decrease when an older Tipped event arrives later', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 2, {
        clientRef: '2'.repeat(32),
        totalAfter: BigInt(40_000_000),
      }),
    ]
    await poll(t)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        tippedEvent(START + 1, {
          clientRef: '1'.repeat(32),
          totalAfter: BigInt(20_000_000),
        }),
      ],
    })
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.totals[SNAPSHOT_TOKEN]).toBe('40000000')
  })

  it('an event that contradicts a client-reported failure flags the record and offers no retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const prepared = await prepareTip(t, s.readerId, s.articleId, s.authorId)
    await t
      .withIdentity({ subject: `${s.readerId}|session` })
      .mutation(api.chain.submissions.recordSendFailed, {
        submissionId: prepared.submissionId,
        reason: 'send_error',
      })
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 1, { clientRef: prepared.clientRefs[0] }),
    ]
    await poll(t)
    const sub = await t.run((ctx) => ctx.db.get(prepared.submissionId))
    expect(sub).toMatchObject({
      status: 'FAILED',
      needsReview: true,
      lastError: 'event_after_failure',
    })
    const status = await t
      .withIdentity({ subject: `${s.readerId}|session` })
      .query(api.chain.submissions.getSubmissionStatus, {
        submissionId: prepared.submissionId,
      })
    expect(status?.canRetry).toBe(false)
  })

  it('money to another payee is MISMATCH author from the event', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const prepared = await prepareTip(t, s.readerId, s.articleId, s.authorId)
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 1, {
        clientRef: prepared.clientRefs[0],
        author: NEW_AUTHOR,
      }),
    ]
    await poll(t)
    expect(
      await t.run((ctx) => ctx.db.get(prepared.related[0]!.id as Id<'tips'>))
    ).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'author',
      onChainAuthorAddress: NEW_AUTHOR,
    })
  })

  it('a submitted record expires only once the indexer has covered maxTime', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const prepared = await prepareTip(t, s.readerId, s.articleId, s.authorId)
    const chain = fakeChain()
    // The chain has not reached maxTime yet.
    chain.state.latestLedger = START + 10
    vi.setSystemTime((prepared.maxTime + 1) * 1000)
    await poll(t)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(
      (await t.run((ctx) => ctx.db.get(prepared.submissionId)))!.status
    ).toBe('PREPARED')
    // Ledgers past maxTime + margin have been indexed.
    chain.state.latestLedger =
      START +
      100 +
      Math.ceil((prepared.maxTime + 60 - Math.floor(T0 / 1000)) / 5)
    await poll(t)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(
      (await t.run((ctx) => ctx.db.get(prepared.submissionId)))!.status
    ).toBe('EXPIRED')
  })
})

describe('article and config handlers', () => {
  it('updates only the article row of the current chain epoch', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    // After a testnet reset the earlier row (same article key, older epoch,
    // later event id) is created first and the current epoch's row second.
    const currentRow = await t.run(async (ctx) => {
      const row = (await ctx.db.get(s.chainArticleId))!
      await ctx.db.patch(s.chainArticleId, {
        chainEpoch: 'testnet-before-reset',
        lastEventId: '9'.repeat(19) + '-' + '9'.repeat(10),
        totals: { [SNAPSHOT_TOKEN]: '999' },
      })
      const { _id, _creationTime, ...fields } = row
      void _id
      void _creationTime
      return ctx.db.insert('chainArticles', fields)
    })
    const chain = fakeChain()
    chain.state.events = [
      tippedEvent(START + 5, {
        clientRef: 'd'.repeat(32),
        totalAfter: BigInt(10_000_000),
      }),
    ]
    await poll(t)
    const [current, old] = await t.run((ctx) =>
      Promise.all([ctx.db.get(currentRow), ctx.db.get(s.chainArticleId)])
    )
    expect(current!.totals[SNAPSHOT_TOKEN]).toBe('10000000')
    expect(old!.totals[SNAPSHOT_TOKEN]).toBe('999')
  })

  it('each Core event updates the right table', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    await t.run((ctx) =>
      ctx.db.insert('chainConfig', {
        network: 'TESTNET',
        chainEpoch: 'testnet-idx',
        coreContractId: SNAPSHOT_CORE,
        tokenContractId: SNAPSHOT_TOKEN,
        minTip: '1',
        paused: {},
        refreshedAt: Date.now(),
      })
    )
    const chain = fakeChain()
    const registered = coreEventJson('article_registered')
    setTopic(registered, 1, { bytes: ARTICLE_KEY })
    setTopic(registered, 2, { address: AUTHOR })
    setData(registered, 'article_ref', { bytes: ARTICLE_REF })
    setData(registered, 'content_hash', { bytes: '11'.repeat(32) })
    const content = coreEventJson('content_updated')
    setTopic(content, 1, { bytes: ARTICLE_KEY })
    const splits = coreEventJson('splits_set')
    setTopic(splits, 1, { bytes: ARTICLE_KEY })
    const proposed = coreEventJson('author_proposed')
    setTopic(proposed, 1, { bytes: ARTICLE_KEY })
    setData(proposed, 'new_author', { address: NEW_AUTHOR })
    const cancelled = coreEventJson('author_proposal_cancelled')
    setTopic(cancelled, 1, { bytes: ARTICLE_KEY })
    setData(cancelled, 'new_author', { address: NEW_AUTHOR })
    const tokenSet = coreEventJson('token_set')
    setTopic(tokenSet, 1, { address: SNAPSHOT_TOKEN })
    setData(tokenSet, 'min_tip', { i128: '5000000' })

    // Each event lands in a new ledger after the last scanned one.
    let ledger = START
    chain.state.latestLedger = START
    const step = async (json: ReturnType<typeof coreEventJson>) => {
      ledger++
      chain.state.latestLedger = ledger
      chain.state.events.push(coreRpcEvent(json, { ledger }))
      await poll(t)
      return t.run((ctx) => ctx.db.get(s.chainArticleId))
    }

    expect(await step(registered)).toMatchObject({
      status: 'REGISTERED',
      authorAddress: AUTHOR,
      contentHash: '11'.repeat(32),
      contentVersion: 1,
      registeredLedger: START + 1,
    })
    expect(await step(content)).toMatchObject({
      contentHash: 'cd'.repeat(32),
      contentVersion: 2,
    })
    expect((await step(splits))!.splits).toEqual([
      {
        recipient: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG5',
        bps: 6000,
      },
    ])
    expect(await step(proposed)).toMatchObject({ pendingAuthor: NEW_AUTHOR })
    expect((await step(cancelled))!.pendingAuthor).toBeUndefined()
    await step(tokenSet)
    const config = await t.run((ctx) => ctx.db.query('chainConfig').first())
    expect(config!.minTip).toBe('5000000')
    expect((await events(t)).every((e) => e.handled === 'done')).toBe(true)
    await expectRedispatchChangesNothing(t)
  })

  it('rejects a registration whose article_id is not derived from author and article_ref', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const chain = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const forged = coreEventJson('article_registered')
    setTopic(forged, 1, { bytes: ARTICLE_KEY })
    // Another author's registration cannot carry this article's key.
    setTopic(forged, 2, { address: NEW_AUTHOR })
    setData(forged, 'article_ref', { bytes: ARTICLE_REF })
    const otherRef = coreEventJson('article_registered')
    setTopic(otherRef, 1, { bytes: ARTICLE_KEY })
    setTopic(otherRef, 2, { address: AUTHOR })
    setData(otherRef, 'article_ref', { bytes: 'cd'.repeat(32) })
    chain.state.events = [
      coreRpcEvent(forged, { ledger: START + 1 }),
      coreRpcEvent(otherRef, { ledger: START + 2 }),
    ]
    await poll(t)
    expect((await events(t)).map((e) => e.handled)).toEqual(['error', 'error'])
    const article = await t.run((ctx) => ctx.db.get(s.chainArticleId))
    expect(article!.status).toBe('SUBMITTED')
  })

  it('an article registered outside the app is an orphan', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    chain.state.events = [
      coreRpcEvent(coreEventJson('article_registered'), { ledger: START + 1 }),
    ]
    await poll(t)
    expect((await events(t))[0]!.handled).toBe('orphan')
  })
})

describe('lag, retention and reset', () => {
  it('reports LAGGING beyond 720 ledgers and warns near the retention edge', async () => {
    expect(
      cursorStatus({
        lastLedger: 100,
        latestLedger: 100 + LAG_ALERT_LEDGERS,
        oldestLedger: 1,
      })
    ).toBe('OK')
    expect(
      cursorStatus({
        lastLedger: 100,
        latestLedger: 101 + LAG_ALERT_LEDGERS,
        oldestLedger: 1,
      })
    ).toBe('LAGGING')
    expect(
      cursorStatus({ lastLedger: 100, latestLedger: 200, oldestLedger: 101 })
    ).toBe('BEHIND_RETENTION')

    const t = convexTest(schema, modules)
    const chain = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.state.events = [tippedEvent(START + 1)]
    chain.state.oldestLedger = START + 100 - RETENTION_ALERT_LEDGERS + 1
    await poll(t, { pageLimit: 1, maxPages: 1 })
    // One full page: lastLedger stays behind and the lag is large.
    chain.state.latestLedger = START + 100 + LAG_ALERT_LEDGERS + 1
    chain.state.oldestLedger = START - 10
    await t.run(async (ctx) => {
      const c = (await ctx.db.query('chainCursor').first())!
      await ctx.db.patch(c._id, { lastLedger: START + 100 })
    })
    chain.state.events.push(
      tippedEvent(START + 2, { clientRef: 'c'.repeat(32) })
    )
    await poll(t, { pageLimit: 1, maxPages: 1 })
    const c = await cursor(t)
    expect(c!.status).toBe('LAGGING')
    const codes = errors.mock.calls.map((args) => String(args[0]))
    expect(codes.some((m) => m.includes('CHAIN_INDEXER_LAGGING'))).toBe(true)

    chain.state.oldestLedger = START + 100 - RETENTION_ALERT_LEDGERS + 10
    chain.state.latestLedger = START + 100
    await t.mutation(internal.chain.indexer.replayFrom, {
      fromLedger: START + 50,
    })
    await poll(t)
    expect(
      errors.mock.calls.some((args) =>
        String(args[0]).includes('CHAIN_INDEXER_RETENTION_RISK')
      )
    ).toBe(true)
  })

  it('stops with BEHIND_RETENTION instead of skipping a gap, and nothing expires', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    const prepared = await prepareTip(t, s.readerId, s.articleId, s.authorId)
    const chain = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.state.oldestLedger = START + 5
    const result = await poll(t)
    expect(result).toEqual({ status: 'stopped', reason: 'behind_retention' })
    expect(await cursor(t)).toMatchObject({ status: 'BEHIND_RETENTION' })
    expect(
      chain.fetch.calls.filter((c) => c.method === 'getEvents')
    ).toHaveLength(0)
    vi.setSystemTime((prepared.maxTime + 3600) * 1000)
    await t.run(async (ctx) => {
      const c = (await ctx.db.query('chainCursor').first())!
      await ctx.db.patch(c._id, {
        lastLedgerCloseTime: prepared.maxTime + 3600,
      })
    })
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(
      (await t.run((ctx) => ctx.db.get(prepared.submissionId)))!.status
    ).toBe('PREPARED')

    // After a backfill the operator replays from the first missing ledger.
    chain.state.oldestLedger = START - 10
    await t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START })
    expect(await poll(t)).toMatchObject({ status: 'ok' })
    expect((await cursor(t))!.status).toBe('OK')
  })

  it('refuses a replay that skips unindexed ledgers unless they were backfilled', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await poll(t)
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
    // RPC retention moved past the covered ledger: START + 101 to + 499 were
    // never read.
    chain.state.latestLedger = START + 1_000
    chain.state.oldestLedger = START + 500
    expect(await poll(t)).toMatchObject({ reason: 'behind_retention' })
    await expect(
      t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START + 500 })
    ).rejects.toThrow(/never indexed/)
    expect((await cursor(t))!.status).toBe('BEHIND_RETENTION')
    // After ingestBackfill filled the gap, the operator says so.
    await t.mutation(internal.chain.indexer.replayFrom, {
      fromLedger: START + 500,
      gapBackfilled: true,
    })
    expect(await poll(t)).toMatchObject({ status: 'ok' })
    expect((await cursor(t))!.lastLedger).toBe(START + 1_000)
  })

  it('detects a testnet reset when the ledger sequence drops', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await poll(t)
    expect((await cursor(t))!.lastLedger).toBe(START + 100)
    chain.state.latestLedger = 500
    chain.state.oldestLedger = 1
    expect(await poll(t)).toEqual({
      status: 'stopped',
      reason: 'reset_detected',
    })
    expect(await cursor(t)).toMatchObject({ status: 'RESET_DETECTED' })
    // It stays stopped until a new epoch or a replay.
    chain.state.latestLedger = START + 200
    expect(await poll(t)).toEqual({
      status: 'stopped',
      reason: 'reset_detected',
    })

    // A new epoch with its own start ledger starts a fresh cursor.
    vi.stubEnv('CHAIN_EPOCH', 'testnet-idx-2')
    vi.stubEnv('INDEXER_START_LEDGER', String(START + 150))
    expect(await poll(t)).toMatchObject({ status: 'ok' })
    expect(await cursor(t)).toMatchObject({
      chainEpoch: 'testnet-idx-2',
      status: 'OK',
      lastLedger: START + 200,
    })
  })

  it('detects a testnet reset when the Core instance is missing', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.state.contractMissing = true
    expect(await poll(t)).toEqual({
      status: 'stopped',
      reason: 'reset_detected',
    })
    expect(await cursor(t)).toMatchObject({
      status: 'RESET_DETECTED',
      statusReason: 'core_instance_missing',
    })
    expect(
      isMissingContractError('HostError: Error(Storage, MissingValue)')
    ).toBe(true)
    expect(isMissingContractError('HostError: Error(Contract, #1)')).toBe(false)
  })
})

describe('configuration, guard and ops status', () => {
  it('does nothing until the contract IDs and start ledger are set', async () => {
    const t = convexTest(schema, modules)
    const chain = fakeChain()
    vi.stubEnv('INDEXER_START_LEDGER', '')
    expect(await poll(t)).toEqual({
      status: 'skipped',
      reason: 'not_configured',
    })
    expect(chain.fetch.calls).toHaveLength(0)
  })

  it('refuses to run off testnet', async () => {
    const t = convexTest(schema, modules)
    fakeChain()
    vi.stubEnv('STELLAR_NETWORK', 'MAINNET')
    await expect(poll(t)).rejects.toThrow()
    await expect(
      t.mutation(internal.chain.indexer.replayFrom, { fromLedger: START })
    ).rejects.toThrow()
  })

  it('getIndexerStatus answers only users in OPS_USER_IDS', async () => {
    const t = convexTest(schema, modules)
    const s = await seedArticle(t)
    fakeChain()
    await poll(t)
    const reader = t.withIdentity({ subject: `${s.readerId}|session` })
    expect(await t.query(api.chain.indexer.getIndexerStatus, {})).toBeNull()
    expect(
      await reader.query(api.chain.indexer.getIndexerStatus, {})
    ).toBeNull()
    vi.stubEnv('OPS_USER_IDS', `other, ${s.readerId}`)
    const status = await reader.query(api.chain.indexer.getIndexerStatus, {})
    expect(status).toMatchObject({
      network: 'TESTNET',
      chainEpoch: 'testnet-idx',
      startLedger: START,
      contracts: { core: SNAPSHOT_CORE },
      cursor: { status: 'OK', lastLedger: START + 100 },
      leaseHeld: false,
    })
  })

  it('redispatch resolves events that had no handler when stored', async () => {
    const t = convexTest(schema, modules)
    fakeChain()
    const unknown = coreEventJson('treasury_set')
    setTopic(unknown, 0, { symbol: 'future_event' })
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [coreRpcEvent(unknown, { ledger: START + 1 })],
    })
    expect((await events(t))[0]!.handled).toBe('pending')
    expect(await t.mutation(internal.chain.indexer.redispatch, {})).toEqual({
      checked: 1,
      resolved: 0,
    })
  })
})
