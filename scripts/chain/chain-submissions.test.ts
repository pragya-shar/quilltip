/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  EXPIRY_COVERAGE_MARGIN_SECONDS,
  RPC_RETENTION_MS,
  applyStoredTippedEvent,
  prepareTipSubmission,
  type PrepareTipItem,
  type StoredTippedEvent,
} from '../../convex/lib/chain/submissionStore'
import { acquireLease, releaseLease } from '../../convex/lib/chain/lease'
import { verifyRetryDelayMs } from '../../convex/chain/submissions'
import {
  AUTHOR,
  CORE,
  OTHER_AUTHOR,
  OTHER_CONTRACT,
  OTHER_TOKEN,
  TIPPER,
  TOKEN,
  fakeRpcFetch,
  failedResponse,
  notFoundResponse,
  realOtherContractSuccess,
  seedAddress,
  successResponse,
  tippedEventXdr,
} from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const ARTICLE_KEY =
  '817a22030ab3bde847ecd28ec9de23f416a043ed1a720d48a9fbeba662a4a9ba'
const HIGHLIGHT_KEY =
  'e3551930d1b1612eda907c05db04be6588619981e505e04e465885aef7480584'
const HASH = 'a1'.repeat(32)
const HASH2 = 'b2'.repeat(32)
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0)

function stubChainEnv(overrides: Record<string, string> = {}) {
  const env = {
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: 'testnet-test',
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
    const otherId = await db.insert('users', {
      username: 'other',
      email: 'other@example.test',
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
    return { authorId, readerId, otherId, articleId }
  })
}

type Seeded = Awaited<ReturnType<typeof seed>>

function articleItem(s: Seeded, gross = '1000000'): PrepareTipItem {
  return {
    table: 'tips',
    fields: {
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: 0.25,
      amountCents: 25,
    },
    articleKey: ARTICLE_KEY,
    authorAddress: AUTHOR,
    grossBaseUnits: gross,
  }
}

function highlightItem(s: Seeded, gross = '2000000'): PrepareTipItem {
  return {
    table: 'highlightTips',
    fields: {
      highlightId: HIGHLIGHT_KEY.slice(0, 28),
      articleId: s.articleId,
      tipperId: s.readerId,
      authorId: s.authorId,
      highlightText: 'The quick brown fox',
      articleTitle: 'Words',
      articleSlug: 'words',
      amountUsd: 0.5,
      amountCents: 50,
      startOffset: 120,
      endOffset: 163,
    },
    articleKey: ARTICLE_KEY,
    highlightKey: HIGHLIGHT_KEY,
    authorAddress: AUTHOR,
    grossBaseUnits: gross,
  }
}

async function prepare(
  t: T,
  s: Seeded,
  items: PrepareTipItem[] = [articleItem(s)],
  requestId = 'req-1'
) {
  return t.run((ctx) =>
    prepareTipSubmission(ctx, {
      userId: s.readerId,
      requestId,
      tipperAddress: TIPPER,
      items,
      now: Date.now(),
    })
  )
}

function asReader(t: T, s: Seeded) {
  return t.withIdentity({ subject: `${s.readerId}|session` })
}

async function submission(t: T, id: Id<'chainSubmissions'>) {
  return t.run(async (ctx) => (await ctx.db.get(id))!)
}

async function rows(t: T, id: Id<'chainSubmissions'>) {
  return t.run(async (ctx) => {
    const sub = (await ctx.db.get(id))!
    return Promise.all(
      sub.related.map(
        async (link: { id: string }) => (await ctx.db.get(link.id as never))!
      )
    ) as Promise<Array<Record<string, unknown>>>
  })
}

async function clientRefs(t: T, id: Id<'chainSubmissions'>) {
  return (await submission(t, id)).clientRefs
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

function stubRpc(responder: Parameters<typeof fakeRpcFetch>[0]) {
  const fetch = fakeRpcFetch(responder)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<{ code: string }>).data.code
}

/** Submits and runs the first verification with the given transaction. */
async function submitAndVerify(
  t: T,
  s: Seeded,
  id: Id<'chainSubmissions'>,
  respond: (refs: string[]) => unknown,
  hash = HASH
) {
  const refs = await clientRefs(t, id)
  stubRpc(() => respond(refs))
  await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
    submissionId: id,
    txHash: hash,
  })
  await t.finishAllScheduledFunctions(() => vi.runAllTimers())
}

describe('prepare', () => {
  it('is gated by CHAIN_V2_ENABLED', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect(await errorCode(prepare(t, s))).toBe('CHAIN_V2_DISABLED')
    vi.stubEnv('CHAIN_V2_ENABLED', 'true')
    vi.stubEnv('STELLAR_NETWORK', 'MAINNET')
    await expect(prepare(t, s)).rejects.toThrow()
  })

  it('creates PREPARED rows and returns the same records for a repeated requestId', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await prepare(t, s)
    const again = await prepare(t, s)
    expect(again).toMatchObject({
      submissionId: first.submissionId,
      clientRefs: first.clientRefs,
      existing: true,
    })
    const sub = await submission(t, first.submissionId)
    expect(sub).toMatchObject({
      status: 'PREPARED',
      kind: 'tip',
      contractId: CORE,
      network: 'TESTNET',
      chainEpoch: 'testnet-test',
      maxTime: Math.floor(T0 / 1000) + 300,
    })
    const [row] = await rows(t, first.submissionId)
    expect(row).toMatchObject({
      status: 'PREPARED',
      contractVersion: 'v2',
      channel: 'direct',
      clientRef: first.clientRefs[0],
      grossBaseUnits: '1000000',
      tokenContractId: TOKEN,
      expectedTipperAddress: TIPPER,
      expectedAuthorAddress: AUTHOR,
      chainArticleKey: ARTICLE_KEY,
    })
    expect(first.clientRefs[0]).toMatch(/^[0-9a-f]{32}$/)
    const count = await t.run((ctx) =>
      ctx.db.query('chainSubmissions').collect()
    )
    expect(count).toHaveLength(1)
  })

  it('refuses a requestId of another user, bad amounts and self tips', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await prepare(t, s)
    expect(
      await errorCode(
        t.run((ctx) =>
          prepareTipSubmission(ctx, {
            userId: s.otherId,
            requestId: 'req-1',
            tipperAddress: seedAddress(40),
            items: [articleItem(s)],
            now: Date.now(),
          })
        )
      )
    ).toBe('INVALID_PREPARE')
    expect(
      await errorCode(prepare(t, s, [articleItem(s, '0')], 'req-zero'))
    ).toBe('INVALID_PREPARE')
    expect(
      await errorCode(
        prepare(
          t,
          s,
          [{ ...articleItem(s), authorAddress: TIPPER }],
          'req-self'
        )
      )
    ).toBe('INVALID_PREPARE')
  })
})

describe('recordSubmitted', () => {
  it('moves PREPARED to SUBMITTED once, accepts the same hash again and refuses another', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    const reader = asReader(t, s)
    expect(
      await reader.mutation(api.chain.submissions.recordSubmitted, {
        submissionId,
        txHash: HASH.toUpperCase(),
      })
    ).toEqual({ status: 'SUBMITTED', duplicate: false })
    expect(
      await reader.mutation(api.chain.submissions.recordSubmitted, {
        submissionId,
        txHash: HASH,
      })
    ).toEqual({ status: 'SUBMITTED', duplicate: true })
    expect(
      await errorCode(
        reader.mutation(api.chain.submissions.recordSubmitted, {
          submissionId,
          txHash: HASH2,
        })
      )
    ).toBe('INVALID_STATE')
    const [row] = await rows(t, submissionId)
    expect(row).toMatchObject({ status: 'SUBMITTED', stellarTxId: HASH })
  })

  it('refuses a hash already recorded for another submission', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const a = await prepare(t, s, [articleItem(s)], 'req-a')
    const b = await prepare(t, s, [articleItem(s)], 'req-b')
    stubRpc(() => notFoundResponse(HASH))
    const reader = asReader(t, s)
    await reader.mutation(api.chain.submissions.recordSubmitted, {
      submissionId: a.submissionId,
      txHash: HASH,
    })
    expect(
      await errorCode(
        reader.mutation(api.chain.submissions.recordSubmitted, {
          submissionId: b.submissionId,
          txHash: HASH,
        })
      )
    ).toBe('DUPLICATE_TX')
  })

  it('is owner-only and validates the hash', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    expect(
      await errorCode(
        t
          .withIdentity({ subject: `${s.otherId}|session` })
          .mutation(api.chain.submissions.recordSubmitted, {
            submissionId,
            txHash: HASH,
          })
      )
    ).toBe('NOT_FOUND')
    expect(
      await errorCode(
        t.mutation(api.chain.submissions.recordSubmitted, {
          submissionId,
          txHash: HASH,
        })
      )
    ).toBe('UNAUTHENTICATED')
    expect(
      await errorCode(
        asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
          submissionId,
          txHash: 'xyz',
        })
      )
    ).toBe('INVALID_TX_HASH')
  })

  it('two concurrent submits of different hashes leave one hash', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    const reader = asReader(t, s)
    const results = await Promise.allSettled([
      reader.mutation(api.chain.submissions.recordSubmitted, {
        submissionId,
        txHash: HASH,
      }),
      reader.mutation(api.chain.submissions.recordSubmitted, {
        submissionId,
        txHash: HASH2,
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const sub = await submission(t, submissionId)
    const winner = results.findIndex((r) => r.status === 'fulfilled')
    expect(sub.txHash).toBe(winner === 0 ? HASH : HASH2)
  })
})

describe('verification (rule (a))', () => {
  it('confirms a direct tip whose Tipped event matches', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    await submitAndVerify(t, s, submissionId, (refs) =>
      successResponse(HASH, [[tipped(refs[0]!)]])
    )
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'CONFIRMED',
      ledger: 6_000_000,
    })
    const [row] = await rows(t, submissionId)
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      stellarLedger: 6_000_000,
      feeBaseUnits: '25000',
      netBaseUnits: '975000',
      onChainAuthorAddress: AUTHOR,
      chainContentVersion: 1,
    })
    expect(typeof row!.verifiedAt).toBe('number')
    const status = await asReader(t, s).query(
      api.chain.submissions.getSubmissionStatus,
      { submissionId }
    )
    expect(status).toMatchObject({ status: 'CONFIRMED', canRetry: false })
  })

  it('confirms a highlight tip with the expected highlight_id', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s, [highlightItem(s)])
    await submitAndVerify(t, s, submissionId, (refs) =>
      successResponse(HASH, [
        [
          tipped(refs[0]!, {
            gross: BigInt(2_000_000),
            highlightId: HIGHLIGHT_KEY,
          }),
        ],
      ])
    )
    const [row] = await rows(t, submissionId)
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      highlightId: HIGHLIGHT_KEY.slice(0, 28),
    })
  })

  it.each([
    ['article_id', { articleId: 'cd'.repeat(32) }],
    ['tipper', { tipper: seedAddress(50) }],
    ['token', { token: OTHER_TOKEN }],
    ['gross', { gross: BigInt(999_999) }],
    ['highlight_id', { highlightId: HIGHLIGHT_KEY }],
    ['fee', { fee: BigInt(7) }],
  ])(
    'a SUCCESS transaction with a different %s is MISMATCH, never FAILED',
    async (field, change) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const { submissionId } = await prepare(t, s)
      await submitAndVerify(t, s, submissionId, (refs) =>
        successResponse(HASH, [[tipped(refs[0]!, change)]])
      )
      expect(await submission(t, submissionId)).toMatchObject({
        status: 'MISMATCH',
        mismatchReason: `field:${field}`,
        needsReview: true,
      })
      const [row] = await rows(t, submissionId)
      expect(row).toMatchObject({
        status: 'MISMATCH',
        mismatchReason: `field:${field}`,
        needsReview: true,
      })
      const status = await asReader(t, s).query(
        api.chain.submissions.getSubmissionStatus,
        { submissionId }
      )
      expect(status?.canRetry).toBe(false)
    }
  )

  it('money sent to another payee is MISMATCH author with the on-chain address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    await submitAndVerify(t, s, submissionId, (refs) =>
      successResponse(HASH, [[tipped(refs[0]!, { author: OTHER_AUTHOR })]])
    )
    const [row] = await rows(t, submissionId)
    expect(row).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'author',
      needsReview: false,
      onChainAuthorAddress: OTHER_AUTHOR,
    })
  })

  it.each([
    [
      'another contract (recorded testnet response)',
      () => realOtherContractSuccess(HASH),
    ],
    [
      'another contract emitting Tipped',
      (refs: string[]) =>
        successResponse(HASH, [
          [tipped(refs[0]!, { contractId: OTHER_CONTRACT })],
        ]),
    ],
    [
      'another function of the configured contract',
      (refs: string[]) =>
        successResponse(HASH, [
          [tipped(refs[0]!, { name: 'article_registered' })],
        ]),
    ],
  ])(
    'a SUCCESS transaction calling %s is MISMATCH no_event',
    async (_label, respond) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const { submissionId } = await prepare(t, s)
      await submitAndVerify(t, s, submissionId, respond)
      expect(await submission(t, submissionId)).toMatchObject({
        status: 'MISMATCH',
        mismatchReason: 'no_event',
        needsReview: true,
      })
    }
  )

  it('RPC FAILED marks the record FAILED and offers a retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    await submitAndVerify(t, s, submissionId, () => failedResponse(HASH))
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'FAILED',
      lastError: 'transaction_failed',
    })
    const status = await asReader(t, s).query(
      api.chain.submissions.getSubmissionStatus,
      { submissionId }
    )
    expect(status?.canRetry).toBe(true)
  })

  it('confirms every row of a batch sharing one hash, matched by client_ref', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s, [
      articleItem(s),
      highlightItem(s),
    ])
    await submitAndVerify(t, s, submissionId, (refs) =>
      successResponse(HASH, [
        [
          tipped(refs[1]!, {
            gross: BigInt(2_000_000),
            highlightId: HIGHLIGHT_KEY,
          }),
          tipped(refs[0]!),
        ],
      ])
    )
    const sub = await submission(t, submissionId)
    expect(sub).toMatchObject({ kind: 'tip_batch', status: 'CONFIRMED' })
    const batchRows = await rows(t, submissionId)
    expect(batchRows.map((r) => [r.status, r.stellarTxId, r.channel])).toEqual([
      ['CONFIRMED', HASH, 'batch'],
      ['CONFIRMED', HASH, 'batch'],
    ])
  })

  it('a batch with one wrong item is MISMATCH as a whole', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s, [
      articleItem(s),
      articleItem(s, '3000000'),
    ])
    await submitAndVerify(t, s, submissionId, (refs) =>
      successResponse(HASH, [
        [tipped(refs[0]!), tipped(refs[1]!, { gross: BigInt(3_000_001) })],
      ])
    )
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:gross',
    })
    expect((await rows(t, submissionId)).map((r) => r.status)).toEqual([
      'CONFIRMED',
      'MISMATCH',
    ])
  })

  it('applying the same verification twice concurrently changes nothing more', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, clientRefs: refs } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    const rowId = (await submission(t, submissionId)).related[0]!.id as string
    const confirm = {
      submissionId,
      txHash: HASH,
      ledger: 6_000_000,
      outcomes: [
        {
          key: rowId,
          status: 'CONFIRMED' as const,
          needsReview: false,
          event: null,
        },
      ],
    }
    const mismatch = {
      ...confirm,
      outcomes: [
        {
          key: rowId,
          status: 'MISMATCH' as const,
          mismatchReason: 'no_event',
          needsReview: true,
          event: null,
        },
      ],
    }
    const results = await Promise.all([
      t.mutation(internal.chain.submissions.applyVerification, confirm),
      t.mutation(internal.chain.submissions.applyVerification, mismatch),
    ])
    expect(results.sort()).toEqual(['applied', 'skipped'])
    const sub = await submission(t, submissionId)
    expect(['CONFIRMED', 'MISMATCH']).toContain(sub.status)
    const [row] = await rows(t, submissionId)
    expect(row!.status).toBe(sub.status)
    expect(refs).toHaveLength(1)
  })
})

describe('retries, recheck and expiry', () => {
  it('keeps a NOT_FOUND transaction SUBMITTED and retries with backoff until maxTime + 10 min', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    const fetch = stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    const sub = await submission(t, submissionId)
    expect(sub.status).toBe('SUBMITTED')
    const calls = fetch.calls.filter((c) => c.method === 'getTransaction')
    expect(calls.length).toBeGreaterThan(5)
    expect(sub.attempts).toBe(calls.length)
    expect(Date.now()).toBeLessThanOrEqual((sub.maxTime + 600) * 1000 + 60_000)
    expect([0, 1, 2, 3, 4, 5, 10].map(verifyRetryDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ])
  })

  it('an RPC outage changes no state and records the error', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    stubRpc(() => ({ httpStatus: 503 }))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    vi.runOnlyPendingTimers()
    await t.finishInProgressScheduledFunctions()
    let sub = await submission(t, submissionId)
    expect(sub.status).toBe('SUBMITTED')
    expect(sub.lastError).toContain('HTTP 503')
    expect(sub.attempts).toBe(1)

    // The next retry sees the transaction and confirms it.
    const refs = sub.clientRefs
    stubRpc(() => successResponse(HASH, [[tipped(refs[0]!)]]))
    vi.runOnlyPendingTimers()
    await t.finishInProgressScheduledFunctions()
    sub = await submission(t, submissionId)
    expect(sub.status).toBe('CONFIRMED')
  })

  async function setCursor(
    t: T,
    lastLedgerCloseTime: number,
    status: 'OK' | 'LAGGING' | 'BEHIND_RETENTION' = 'OK'
  ) {
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainCursor').collect()) {
        await ctx.db.delete(row._id)
      }
      await ctx.db.insert('chainCursor', {
        network: 'TESTNET',
        chainEpoch: 'testnet-test',
        lastLedger: 6_000_050,
        lastLedgerCloseTime,
        latestLedger: 6_000_060,
        oldestLedger: 5_879_140,
        lagLedgers: 10,
        status,
        updatedAt: Date.now(),
      })
    })
  }

  it('expires an unfound submission only after the indexer covers maxTime', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.setSystemTime((maxTime + 601) * 1000)

    // Before coverage: the cursor has not passed maxTime.
    await setCursor(t, maxTime - 5)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('SUBMITTED')

    // A cursor behind retention never allows expiry.
    await setCursor(t, maxTime + 3600, 'BEHIND_RETENTION')
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('SUBMITTED')

    // After coverage.
    await setCursor(t, maxTime + EXPIRY_COVERAGE_MARGIN_SECONDS)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'EXPIRED',
    })
    expect((await rows(t, submissionId))[0]!.status).toBe('EXPIRED')
    const status = await asReader(t, s).query(
      api.chain.submissions.getSubmissionStatus,
      { submissionId }
    )
    expect(status?.canRetry).toBe(true)
  })

  it('expires a PREPARED record without a hash under the same rule', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime } = await prepare(t, s)
    const fetch = stubRpc(() => notFoundResponse(HASH))
    vi.setSystemTime((maxTime + 1) * 1000)
    await setCursor(t, maxTime + 10)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('PREPARED')
    await setCursor(t, maxTime + 60)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('EXPIRED')
    expect(fetch.calls).toHaveLength(0)
  })

  it('a recheck finds a late SUCCESS through RPC', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime, clientRefs: refs } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.setSystemTime((maxTime + 700) * 1000)
    stubRpc(() => successResponse(HASH, [[tipped(refs[0]!)]]))
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('CONFIRMED')
  })

  async function storeIndexedEvent(
    t: T,
    clientRef: string,
    overrides: Partial<StoredTippedEvent> = {},
    contractId = CORE
  ) {
    const data: StoredTippedEvent = {
      article_id: ARTICLE_KEY,
      author: AUTHOR,
      tipper: TIPPER,
      token: TOKEN,
      gross: '1000000',
      fee: '25000',
      net: '975000',
      highlight_id: null,
      content_hash: 'ab'.repeat(32),
      content_version: 2,
      client_ref: clientRef,
      total_after: '5000000',
      split_count: 0,
      ...overrides,
    }
    await t.run((ctx) =>
      ctx.db.insert('chainEvents', {
        network: 'TESTNET',
        chainEpoch: 'testnet-test',
        eventId: `0025000000000000000-000000000${Math.floor(Math.random() * 9)}`,
        contractId,
        ledger: 6_000_010,
        ledgerCloseTime: 1795700000,
        txHash: HASH2,
        type: 'tipped',
        topics: ['tipped', ARTICLE_KEY, data.author],
        data,
        clientRef,
        handled: 'pending',
      })
    )
  }

  it('rule (b): an indexed Tipped event resolves a record RPC cannot find', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime, clientRefs: refs } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    vi.setSystemTime((maxTime + 1) * 1000)
    await storeIndexedEvent(t, refs[0]!)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'CONFIRMED',
      txHash: HASH2,
    })
    expect((await rows(t, submissionId))[0]).toMatchObject({
      status: 'CONFIRMED',
      chainContentVersion: 2,
      stellarTxId: HASH2,
    })
  })

  it('rule (b) ignores an event from another contract and applies the expiry rule', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime, clientRefs: refs } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    vi.setSystemTime((maxTime + 1) * 1000)
    await storeIndexedEvent(t, refs[0]!, {}, OTHER_CONTRACT)
    await setCursor(t, maxTime + 60)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('EXPIRED')
  })

  it('an indexed event under another hash blocks expiry and is flagged for review', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime, clientRefs: refs } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.setSystemTime((maxTime + 601) * 1000)
    // The payment landed under HASH2 (for example the outer hash of a fee
    // bump), while the client recorded HASH.
    await storeIndexedEvent(t, refs[0]!)
    await setCursor(t, maxTime + 3600)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'SUBMITTED',
      txHash: HASH,
      needsReview: true,
      lastError: 'event_hash_differs',
    })
    const status = await asReader(t, s).query(
      api.chain.submissions.getSubmissionStatus,
      { submissionId }
    )
    expect(status?.canRetry).toBe(false)
  })

  it('an event for a record the client marked FAILED is flagged and blocks retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, clientRefs: refs } = await prepare(t, s)
    await asReader(t, s).mutation(api.chain.submissions.recordSendFailed, {
      submissionId,
      reason: 'send_error',
    })
    await storeIndexedEvent(t, refs[0]!)
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query('chainEvents')
        .withIndex('by_client_ref', (q) => q.eq('clientRef', refs[0]!))
        .first()
    )
    const result = await t.run((ctx) =>
      applyStoredTippedEvent(ctx, {
        contractId: CORE,
        txHash: stored!.txHash,
        ledger: stored!.ledger,
        eventId: stored!.eventId,
        event: stored!.data as StoredTippedEvent,
        now: Date.now(),
      })
    )
    expect(result).toBe('conflict')
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'FAILED',
      needsReview: true,
      lastError: 'event_after_failure',
    })
    expect((await rows(t, submissionId))[0]).toMatchObject({
      status: 'FAILED',
      needsReview: true,
    })
    const status = await asReader(t, s).query(
      api.chain.submissions.getSubmissionStatus,
      { submissionId }
    )
    expect(status?.canRetry).toBe(false)
  })

  it('a late event moves EXPIRED to MISMATCH or CONFIRMED', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId, maxTime, clientRefs: refs } = await prepare(t, s)
    vi.setSystemTime((maxTime + 1) * 1000)
    await setCursor(t, maxTime + 60)
    stubRpc(() => notFoundResponse(HASH))
    await t.action(internal.chain.submissions.recheckPending, {})
    expect((await submission(t, submissionId)).status).toBe('EXPIRED')

    const result = await t.run((ctx) =>
      applyStoredTippedEvent(ctx, {
        contractId: CORE,
        txHash: HASH2,
        ledger: 6_000_100,
        eventId: 'late-1',
        event: {
          article_id: ARTICLE_KEY,
          author: OTHER_AUTHOR,
          tipper: TIPPER,
          token: TOKEN,
          gross: '1000000',
          fee: '25000',
          net: '975000',
          highlight_id: null,
          content_hash: 'ab'.repeat(32),
          content_version: 1,
          client_ref: refs[0]!,
          total_after: '1000000',
          split_count: 0,
        },
        now: Date.now(),
      })
    )
    expect(result).toBe('linked')
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'author',
    })
    expect((await rows(t, submissionId))[0]).toMatchObject({
      chainEventId: 'late-1',
      onChainAuthorAddress: OTHER_AUTHOR,
    })
  })

  it('an unknown client_ref is reported as an orphan', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const result = await t.run((ctx) =>
      applyStoredTippedEvent(ctx, {
        contractId: CORE,
        txHash: HASH,
        ledger: 1,
        eventId: 'x',
        event: {
          article_id: ARTICLE_KEY,
          author: AUTHOR,
          tipper: TIPPER,
          token: TOKEN,
          gross: '1',
          fee: '0',
          net: '1',
          highlight_id: null,
          content_hash: 'ab'.repeat(32),
          content_version: 1,
          client_ref: '9'.repeat(32),
          total_after: '1',
          split_count: 0,
        },
        now: Date.now(),
      })
    )
    expect(result).toBe('orphan')
  })

  it('flags a record still open at the RPC retention edge', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    stubRpc(() => notFoundResponse(HASH))
    await asReader(t, s).mutation(api.chain.submissions.recordSubmitted, {
      submissionId,
      txHash: HASH,
    })
    await t.finishAllScheduledFunctions(() => vi.runAllTimers())
    vi.setSystemTime(T0 + RPC_RETENTION_MS)
    await t.action(internal.chain.submissions.recheckPending, {})
    expect(await submission(t, submissionId)).toMatchObject({
      status: 'SUBMITTED',
      needsReview: true,
      lastError: 'unresolved_at_retention_edge',
    })
  })

  it('recheck runs under a single lease', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { maxTime } = await prepare(t, s)
    vi.setSystemTime((maxTime + 1) * 1000)
    stubRpc(() => notFoundResponse(HASH))
    await t.run((ctx) =>
      acquireLease(ctx, {
        name: 'recheck',
        holder: 'someone-else',
        ttlMs: 60_000,
        now: Date.now(),
        network: 'TESTNET',
        chainEpoch: 'testnet-test',
      })
    )
    expect(
      await t.action(internal.chain.submissions.recheckPending, {})
    ).toEqual({ skipped: true, checked: 0 })
    vi.setSystemTime((maxTime + 1) * 1000 + 61_000)
    expect(
      await t.action(internal.chain.submissions.recheckPending, {})
    ).toMatchObject({ skipped: false, checked: 1 })
  })
})

describe('client-reported failures', () => {
  it('marks a PREPARED record FAILED and refuses once a hash is recorded', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const a = await prepare(t, s, [articleItem(s)], 'req-a')
    const reader = asReader(t, s)
    await reader.mutation(api.chain.submissions.recordSendFailed, {
      submissionId: a.submissionId,
      reason: 'send_error',
      detail: 'txBadSeq',
    })
    expect(await submission(t, a.submissionId)).toMatchObject({
      status: 'FAILED',
      lastError: 'send_error: txBadSeq',
    })
    const b = await prepare(t, s, [articleItem(s)], 'req-b')
    stubRpc(() => notFoundResponse(HASH))
    await reader.mutation(api.chain.submissions.recordSubmitted, {
      submissionId: b.submissionId,
      txHash: HASH,
    })
    expect(
      await errorCode(
        reader.mutation(api.chain.submissions.recordSendFailed, {
          submissionId: b.submissionId,
          reason: 'simulation_failed',
        })
      )
    ).toBe('INVALID_STATE')
  })
})

describe('guard', () => {
  it('verification refuses to run off testnet', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { submissionId } = await prepare(t, s)
    vi.stubEnv('STELLAR_NETWORK', 'MAINNET')
    await expect(
      t.action(internal.chain.submissions.verifySubmission, {
        submissionId,
        attempt: 0,
      })
    ).rejects.toThrow()
    await expect(
      t.action(internal.chain.submissions.recheckPending, {})
    ).rejects.toThrow()
  })
})

describe('leases', () => {
  it('grants one holder at a time and frees on release or expiry', async () => {
    const t = convexTest(schema, modules)
    const base = {
      name: 'indexer',
      ttlMs: 60_000,
      network: 'TESTNET' as const,
      chainEpoch: 'testnet-test',
    }
    const results = await t.run(async (ctx) => {
      const now = Date.now()
      return [
        await acquireLease(ctx, { ...base, holder: 'a', now }),
        await acquireLease(ctx, { ...base, holder: 'b', now }),
        await acquireLease(ctx, { ...base, holder: 'a', now: now + 1 }),
        await releaseLease(ctx, { name: 'indexer', holder: 'b' }),
        await releaseLease(ctx, { name: 'indexer', holder: 'a' }),
        await acquireLease(ctx, { ...base, holder: 'b', now: now + 2 }),
        await acquireLease(ctx, { ...base, holder: 'a', now: now + 59_000 }),
        await acquireLease(ctx, { ...base, holder: 'a', now: now + 62_003 }),
      ]
    })
    expect(results).toEqual([true, false, true, false, true, true, false, true])
  })
})

describe('chain config', () => {
  it('getChainConfig reports env values and cached views of the configured set', async () => {
    const t = convexTest(schema, modules)
    const empty = await t.query(api.chain.config.getChainConfig, {})
    expect(empty).toMatchObject({
      network: 'TESTNET',
      v2Enabled: true,
      coreContractId: CORE,
      tokenContractId: TOKEN,
      minTip: null,
    })

    const views: Record<string, string> = {}
    const { nativeToScVal } = await import('@stellar/stellar-sdk')
    views.min_tip = nativeToScVal(BigInt(10_000_000), { type: 'i128' }).toXdr(
      'base64'
    )
    views.fee_bps = nativeToScVal(250, { type: 'u32' }).toXdr('base64')
    views.paused = nativeToScVal(false).toXdr('base64')
    stubRpc(async (method, params) => {
      expect(method).toBe('simulateTransaction')
      const { TransactionBuilder, Networks } =
        await import('@stellar/stellar-sdk')
      const tx = TransactionBuilder.fromXdr(
        (params as { transaction: string }).transaction,
        Networks.TESTNET
      ) as import('@stellar/stellar-sdk').Transaction
      const op = tx.operations[0] as unknown as {
        func: { invokeContract: { functionName: { toString(): string } } }
      }
      const fn = op.func.invokeContract.functionName.toString()
      return { latestLedger: 1, results: [{ xdr: views[fn] }] }
    })
    expect(
      await t.action(internal.chain.config.refreshChainConfig, {})
    ).toEqual({
      refreshed: true,
      errors: [],
    })
    expect(await t.query(api.chain.config.getChainConfig, {})).toMatchObject({
      minTip: '10000000',
      feeBps: 250,
      paused: { core: false },
    })

    // A failing view keeps the previous value and records the error.
    stubRpc(() => ({ latestLedger: 1, error: 'host error' }))
    const second = await t.action(internal.chain.config.refreshChainConfig, {})
    expect(second.errors?.length).toBeGreaterThan(0)
    expect(await t.query(api.chain.config.getChainConfig, {})).toMatchObject({
      minTip: '10000000',
      feeBps: 250,
    })
  })

  it('refreshChainConfig does nothing until CORE_CONTRACT_ID is set', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('CORE_CONTRACT_ID', '')
    const fetch = stubRpc(() => ({}))
    expect(
      await t.action(internal.chain.config.refreshChainConfig, {})
    ).toEqual({
      refreshed: false,
    })
    expect(fetch.calls).toHaveLength(0)
  })
})

describe('backfill', () => {
  it('labels v1 rows as v1 only when applied, and is idempotent', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run((ctx) =>
      ctx.db.insert('tips', {
        ...(articleItem(s).fields as never as Record<string, never>),
        status: 'CONFIRMED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never)
    )
    await prepare(t, s) // a v2 row stays v2
    const dry = await t.mutation(internal.chain.backfill.setContractVersionV1, {
      table: 'tips',
    })
    expect(dry).toMatchObject({
      apply: false,
      scanned: 2,
      toUpdate: 1,
      updated: 0,
      isDone: true,
    })
    const applied = await t.mutation(
      internal.chain.backfill.setContractVersionV1,
      {
        table: 'tips',
        apply: true,
      }
    )
    expect(applied).toMatchObject({ toUpdate: 1, updated: 1 })
    const again = await t.mutation(
      internal.chain.backfill.setContractVersionV1,
      {
        table: 'tips',
        apply: true,
      }
    )
    expect(again).toMatchObject({ toUpdate: 0, updated: 0 })
    const versions = await t.run(async (ctx) =>
      (await ctx.db.query('tips').collect())
        .map((r) => r.contractVersion)
        .sort()
    )
    expect(versions).toEqual(['v1', 'v2'])
  })
})
