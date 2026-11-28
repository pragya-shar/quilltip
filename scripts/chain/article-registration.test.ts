/// <reference types="vite/client" />
/**
 * Article registration, content update and author change
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.1): prepare,
 * verification by RPC (rule (a)) and by indexed events (rule (b)), and every
 * prepare rejection.
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { nativeToScVal, xdr, StrKey } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  ARTICLE_SCHEMA,
  articleIdHex,
  articleRefHex,
  hexToBytes,
} from '../../convex/lib/chain/ids'
import { arweaveIdHex } from '../../convex/chain/articles'
import {
  CORE,
  OTHER_CONTRACT,
  fakeRpcFetch,
  failedResponse,
  notFoundResponse,
  seedAddress,
  successResponse,
} from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')
const TESTNET = 'Test SDF Network ; September 2015'
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0)
const AUTHOR = seedAddress(31)
const NEW_WALLET = seedAddress(32)
const COAUTHOR = seedAddress(33)
const STRANGER = seedAddress(34)
const HASH = 'c3'.repeat(32)
const HASH2 = 'd4'.repeat(32)
const CONTENT_HASH = 'ab'.repeat(32)
const UPDATED_HASH = 'cd'.repeat(32)
// 43 base64url characters decode to 32 bytes.
const ARWEAVE_TX = 'A'.repeat(42) + 'E'

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, val] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: 'testnet-test',
    CORE_CONTRACT_ID: CORE,
  })) {
    vi.stubEnv(k, val)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type T = ReturnType<typeof convexTest>

async function seed(
  t: T,
  opts: {
    verified?: boolean
    address?: string | null
    legacy?: boolean
    arweave?: 'matching' | 'stale' | 'none'
    published?: boolean
  } = {}
) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const address = opts.address === undefined ? AUTHOR : opts.address
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      ...(address ? { stellarAddress: address } : {}),
      ...(address && opts.verified !== false
        ? {
            stellarAddressVerifiedAt: now,
            stellarAddressVerifiedNetwork: TESTNET,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    })
    const otherId = await db.insert('users', {
      username: 'other',
      email: 'other@example.test',
      stellarAddress: STRANGER,
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: TESTNET,
      createdAt: now,
      updatedAt: now,
    })
    const arweave = opts.arweave ?? 'none'
    const articleId = await db.insert('articles', {
      slug: 'words',
      title: 'Words',
      content: { type: 'doc', content: [] },
      published: opts.published ?? true,
      authorId,
      authorUsername: 'writer',
      ...(opts.legacy
        ? { contentHash: 'legacy-hash' }
        : {
            contentHash: CONTENT_HASH,
            contentVersion: 1,
            contentHashSchema: ARTICLE_SCHEMA,
          }),
      ...(arweave === 'none'
        ? {}
        : {
            arweaveTxId: ARWEAVE_TX,
            arweaveStatus: 'uploaded',
            arweaveContentHash:
              arweave === 'matching' ? CONTENT_HASH : 'ee'.repeat(32),
          }),
      createdAt: now,
      updatedAt: now,
    })
    return { authorId, otherId, articleId }
  })
}

type Seeded = Awaited<ReturnType<typeof seed>>
const as = (t: T, id: Id<'users'>) =>
  t.withIdentity({ subject: `${id}|session` })

let requestCounter = 0
const rid = () => `req-${++requestCounter}`

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ConvexError) {
      return (error.data as { code: string }).code
    }
    throw error
  }
  throw new Error('expected a ConvexError')
}

// --- Core events, built from contracts/core/src/events.rs -----------------

const sym = (s: string) => nativeToScVal(s, { type: 'symbol' })
const bytes = (hex: string) => nativeToScVal(hexToBytes(hex))
const addr = (a: string) => nativeToScVal(a, { type: 'address' })
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })
const map = (entries: Array<[string, xdr.ScVal]>) =>
  xdr.ScVal.scvMap(
    [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val }))
  )

type Built = { topics: xdr.ScVal[]; data: xdr.ScVal; contractId?: string }

function registered(f: {
  articleKey: string
  author: string
  articleRef: string
  contentHash: string
  arweaveId?: string | null
  splits?: Array<{ recipient: string; bps: number }>
}): Built {
  return {
    topics: [sym('article_registered'), bytes(f.articleKey), addr(f.author)],
    data: map([
      ['article_ref', bytes(f.articleRef)],
      ['content_hash', bytes(f.contentHash)],
      ['arweave_id', f.arweaveId ? bytes(f.arweaveId) : xdr.ScVal.scvVoid()],
      [
        'splits',
        xdr.ScVal.scvVec(
          (f.splits ?? []).map((s) =>
            map([
              ['recipient', addr(s.recipient)],
              ['bps', u32(s.bps)],
            ])
          )
        ),
      ],
    ]),
  }
}

function contentUpdated(f: {
  articleKey: string
  contentHash: string
  arweaveId?: string | null
  contentVersion: number
}): Built {
  return {
    topics: [sym('content_updated'), bytes(f.articleKey)],
    data: map([
      ['content_hash', bytes(f.contentHash)],
      ['arweave_id', f.arweaveId ? bytes(f.arweaveId) : xdr.ScVal.scvVoid()],
      ['content_version', u32(f.contentVersion)],
    ]),
  }
}

function proposed(f: {
  articleKey: string
  newAuthor: string
  liveUntil: number
}): Built {
  return {
    topics: [sym('author_proposed'), bytes(f.articleKey)],
    data: map([
      ['new_author', addr(f.newAuthor)],
      ['live_until_ledger', u32(f.liveUntil)],
    ]),
  }
}

function changed(f: {
  articleKey: string
  previous: string
  next: string
}): Built {
  return {
    topics: [sym('author_changed'), bytes(f.articleKey)],
    data: map([
      ['previous', addr(f.previous)],
      ['new', addr(f.next)],
    ]),
  }
}

function eventXdr(b: Built): string {
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new xdr.ContractId(StrKey.decodeContract(b.contractId ?? CORE)),
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({ topics: b.topics, data: b.data })
    ),
  }).toXdr('base64')
}

let eventCounter = 0
function rpcEvent(b: Built, txHash: string, ledger = 6_000_000) {
  eventCounter++
  return {
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-12-01T12:00:00Z',
    contractId: b.contractId ?? CORE,
    id: `${String(ledger).padStart(19, '0')}-${String(eventCounter).padStart(10, '0')}`,
    txHash,
    topic: b.topics.map((x) => x.toXDR('base64')),
    value: b.data.toXDR('base64'),
    inSuccessfulContractCall: true,
  }
}

function stubRpc(responder: (method: string) => unknown) {
  const fetch = fakeRpcFetch(responder)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function prepare(
  t: T,
  s: Seeded,
  splits?: Array<{ recipient: string; bps: number }>
) {
  return as(t, s.authorId).mutation(api.chain.articles.prepareRegistration, {
    articleId: s.articleId,
    requestId: rid(),
    ...(splits ? { splits } : {}),
  })
}

async function submit(
  t: T,
  s: Seeded,
  submissionId: Id<'chainSubmissions'>,
  hash: string
) {
  await as(t, s.authorId).mutation(api.chain.submissions.recordSubmitted, {
    submissionId,
    txHash: hash,
  })
}

async function verify(t: T, submissionId: Id<'chainSubmissions'>) {
  return t.action(internal.chain.submissions.verifySubmission, {
    submissionId,
    attempt: 0,
  })
}

async function chainRow(t: T, s: Seeded) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chainArticles')
      .filter((q) => q.eq(q.field('articleId'), s.articleId))
      .first()
  )
}

async function submissionRow(t: T, id: Id<'chainSubmissions'>) {
  return t.run((ctx) => ctx.db.get(id))
}

/** Registers the seeded article through prepare, submit and RPC verification. */
async function registerArticle(t: T, s: Seeded) {
  const p = await prepare(t, s)
  await submit(t, s, p.submissionId, HASH)
  stubRpc(() =>
    successResponse(HASH, [
      [
        eventXdr(
          registered({
            articleKey: p.articleKey,
            author: AUTHOR,
            articleRef: p.articleRef!,
            contentHash: p.contentHash!,
            arweaveId: p.arweaveId,
          })
        ),
      ],
    ])
  )
  await verify(t, p.submissionId)
  return p
}

describe('prepareRegistration', () => {
  it('derives the article ID from the verified address and the app reference', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    const ref = await articleRefHex(s.articleId)
    expect(p).toMatchObject({
      kind: 'register',
      contractId: CORE,
      networkPassphrase: TESTNET,
      signer: AUTHOR,
      author: AUTHOR,
      articleRef: ref,
      articleKey: await articleIdHex(AUTHOR, ref),
      contentHash: CONTENT_HASH,
      arweaveId: null,
      splits: [],
      existing: false,
    })
    expect(p.maxTime).toBe(Math.floor(T0 / 1000) + 300)
    const row = await chainRow(t, s)
    expect(row).toMatchObject({
      status: 'PREPARED',
      articleKey: p.articleKey,
      authorAddress: AUTHOR,
      contentHash: CONTENT_HASH,
      contentVersion: 1,
      lastSubmissionId: p.submissionId,
    })
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      kind: 'register',
      status: 'PREPARED',
      clientRefs: [],
      related: [{ table: 'chainArticles', id: row!._id }],
    })
  })

  it('returns the same record for a repeated requestId', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const args = { articleId: s.articleId, requestId: 'same-request' }
    const first = await as(t, s.authorId).mutation(
      api.chain.articles.prepareRegistration,
      args
    )
    const second = await as(t, s.authorId).mutation(
      api.chain.articles.prepareRegistration,
      args
    )
    expect(second.submissionId).toBe(first.submissionId)
    expect(second.existing).toBe(true)
  })

  it('passes the Arweave ID only when the upload reproduces the hash', async () => {
    const t = convexTest(schema, modules)
    const matching = await seed(t, { arweave: 'matching' })
    expect((await prepare(t, matching)).arweaveId).toBe(
      arweaveIdHex(ARWEAVE_TX)
    )
    expect(arweaveIdHex(ARWEAVE_TX)).toMatch(/^[0-9a-f]{64}$/)

    const t2 = convexTest(schema, modules)
    const stale = await seed(t2, { arweave: 'stale' })
    expect((await prepare(t2, stale)).arweaveId).toBeNull()
  })

  it('anchors a legacy article with a canonical hash and no Arweave ID', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { legacy: true, arweave: 'matching' })
    const p = await prepare(t, s)
    expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(p.contentHash).not.toBe('legacy-hash')
    expect(p.arweaveId).toBeNull()
    const article = await t.run((ctx) => ctx.db.get(s.articleId))
    expect(article?.contentHash).toBe('legacy-hash')
  })

  it('accepts valid co-author splits', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const splits = [
      { recipient: AUTHOR, bps: 7_000 },
      { recipient: COAUTHOR, bps: 3_000 },
    ]
    const p = await prepare(t, s, splits)
    expect(p.splits).toEqual(splits)
    expect((await chainRow(t, s))?.splits).toEqual(splits)
  })

  it('uses a new article ID when the verified address changed before registration', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await prepare(t, s)
    await as(t, s.authorId).mutation(api.chain.submissions.recordSendFailed, {
      submissionId: first.submissionId,
      reason: 'wallet_rejected',
    })
    expect((await chainRow(t, s))?.status).toBe('FAILED')
    await t.run((ctx) =>
      ctx.db.patch(s.authorId, { stellarAddress: NEW_WALLET })
    )
    const second = await prepare(t, s)
    expect(second.articleKey).toBe(
      await articleIdHex(NEW_WALLET, second.articleRef!)
    )
    expect(second.articleKey).not.toBe(first.articleKey)
    const rows = await t.run((ctx) => ctx.db.query('chainArticles').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      articleKey: second.articleKey,
      authorAddress: NEW_WALLET,
      status: 'PREPARED',
    })
  })

  describe('rejections', () => {
    it('refuses when payments v2 is off', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      vi.stubEnv('CHAIN_V2_ENABLED', 'false')
      expect(await codeOf(prepare(t, s))).toBe('CHAIN_V2_DISABLED')
    })

    it('refuses a mainnet configuration through the network guard', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      vi.stubEnv('STELLAR_NETWORK', 'PUBLIC')
      await expect(prepare(t, s)).rejects.toThrow()
      expect(
        await t.run((ctx) => ctx.db.query('chainSubmissions').collect())
      ).toHaveLength(0)
    })

    it('refuses an anonymous caller', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      expect(
        await codeOf(
          t.mutation(api.chain.articles.prepareRegistration, {
            articleId: s.articleId,
            requestId: rid(),
          })
        )
      ).toBe('UNAUTHENTICATED')
    })

    it('refuses someone who is not the author', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      expect(
        await codeOf(
          as(t, s.otherId).mutation(api.chain.articles.prepareRegistration, {
            articleId: s.articleId,
            requestId: rid(),
          })
        )
      ).toBe('NOT_AUTHOR')
    })

    it('refuses an author without a wallet', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t, { address: null })
      expect(await codeOf(prepare(t, s))).toBe('NO_WALLET')
    })

    it('refuses an unverified address', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t, { verified: false })
      expect(await codeOf(prepare(t, s))).toBe('WALLET_NOT_VERIFIED')
    })

    it('refuses an address verified on another network', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await t.run((ctx) =>
        ctx.db.patch(s.authorId, {
          stellarAddressVerifiedNetwork:
            'Public Global Stellar Network ; September 2015',
        })
      )
      expect(await codeOf(prepare(t, s))).toBe('WALLET_NOT_VERIFIED')
    })

    it('refuses a draft', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t, { published: false })
      expect(await codeOf(prepare(t, s))).toBe('NOT_PUBLISHED')
    })

    it('refuses a duplicate registration', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await registerArticle(t, s)
      expect((await chainRow(t, s))?.status).toBe('REGISTERED')
      expect(await codeOf(prepare(t, s))).toBe('ALREADY_REGISTERED')
    })

    it('refuses while a registration is in flight', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const p = await prepare(t, s)
      expect(await codeOf(prepare(t, s))).toBe('PENDING')
      await submit(t, s, p.submissionId, HASH)
      expect(await codeOf(prepare(t, s))).toBe('PENDING')
    })

    it('allows a new prepare once an unsent one is past its time bound', async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await prepare(t, s)
      vi.setSystemTime(T0 + 301_000)
      const second = await prepare(t, s)
      expect(second.existing).toBe(false)
    })

    it.each([
      ['one entry', [{ recipient: AUTHOR, bps: 10_000 }], 'TOO_FEW'],
      [
        'six entries',
        [AUTHOR, ...[41, 42, 43, 44, 45].map(seedAddress)].map((r, i) => ({
          recipient: r,
          bps: i === 0 ? 5_000 : 1_000,
        })),
        'TOO_MANY',
      ],
      [
        'first is not the author',
        [
          { recipient: COAUTHOR, bps: 5_000 },
          { recipient: AUTHOR, bps: 5_000 },
        ],
        'FIRST_NOT_AUTHOR',
      ],
      [
        'sum below 10,000',
        [
          { recipient: AUTHOR, bps: 5_000 },
          { recipient: COAUTHOR, bps: 4_999 },
        ],
        'SUM',
      ],
      [
        'a zero share',
        [
          { recipient: AUTHOR, bps: 10_000 },
          { recipient: COAUTHOR, bps: 0 },
        ],
        'NOT_POSITIVE',
      ],
      [
        'a duplicate recipient',
        [
          { recipient: AUTHOR, bps: 5_000 },
          { recipient: AUTHOR, bps: 5_000 },
        ],
        'DUPLICATE',
      ],
      [
        'an invalid address',
        [
          { recipient: AUTHOR, bps: 5_000 },
          { recipient: 'GNOTANADDRESS', bps: 5_000 },
        ],
        'INVALID_ADDRESS',
      ],
      [
        'a fractional share',
        [
          { recipient: AUTHOR, bps: 5_000.5 },
          { recipient: COAUTHOR, bps: 4_999.5 },
        ],
        'NOT_INTEGER',
      ],
    ])('refuses invalid splits: %s', async (_name, splits, code) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      type Data = { code: string; problems: Array<{ code: string }> }
      let data: Data | null = null
      try {
        await prepare(t, s, splits)
      } catch (error) {
        data = (error as ConvexError<Data>).data
      }
      expect(data?.code).toBe('INVALID_SPLITS')
      expect(data?.problems.map((p) => p.code)).toContain(code)
      expect(await chainRow(t, s)).toBeNull()
    })
  })
})

describe('registration verification', () => {
  it('confirms from the ArticleRegistered event (rule (a))', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await submit(t, s, p.submissionId, HASH)
    expect((await chainRow(t, s))?.status).toBe('SUBMITTED')
    stubRpc(() =>
      successResponse(
        HASH,
        [
          [
            eventXdr(
              registered({
                articleKey: p.articleKey,
                author: AUTHOR,
                articleRef: p.articleRef!,
                contentHash: p.contentHash!,
              })
            ),
          ],
        ],
        6_000_123
      )
    )
    expect(await verify(t, p.submissionId)).toBe('confirmed_or_mismatch')
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      needsReview: false,
    })
    expect(await chainRow(t, s)).toMatchObject({
      status: 'REGISTERED',
      registeredLedger: 6_000_123,
      txHash: HASH,
    })
    const availability = await t.query(
      api.chain.articles.getArticleTipAvailability,
      { articleId: s.articleId }
    )
    expect(availability).toMatchObject({
      status: 'registered',
      articleKey: p.articleKey,
      authorAddress: AUTHOR,
    })
  })

  it('is not tippable before confirmation', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const query = () =>
      t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: s.articleId,
      })
    expect(await query()).toEqual({ status: 'unregistered' })
    const p = await prepare(t, s)
    expect(await query()).toEqual({ status: 'pending' })
    await submit(t, s, p.submissionId, HASH)
    expect(await query()).toEqual({ status: 'pending' })
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect(await query()).toEqual({ status: 'paused' })
  })

  it('is paused with v2 on and no Core contract, so no flow is offered', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('CORE_CONTRACT_ID', '')
    const query = () =>
      t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: s.articleId,
      })
    expect(await query()).toEqual({ status: 'paused' })
  })

  it.each([
    ['article ID', { articleKey: 'ee'.repeat(32) }, 'field:article_id'],
    ['content hash', { contentHash: 'ff'.repeat(32) }, 'field:content_hash'],
    ['article reference', { articleRef: '11'.repeat(32) }, 'field:article_ref'],
    ['author', { author: STRANGER }, 'field:author'],
    ['Arweave ID', { arweaveId: '22'.repeat(32) }, 'field:arweave_id'],
    [
      'split',
      {
        splits: [
          { recipient: AUTHOR, bps: 5_000 },
          { recipient: STRANGER, bps: 5_000 },
        ],
      },
      'field:splits',
    ],
  ])(
    'flags a %s mismatch for review and leaves the article unregistered',
    async (_name, override, reason) => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const p = await prepare(t, s)
      await submit(t, s, p.submissionId, HASH)
      const base = {
        articleKey: p.articleKey,
        author: AUTHOR,
        articleRef: p.articleRef!,
        contentHash: p.contentHash!,
      }
      stubRpc(() =>
        successResponse(HASH, [
          [eventXdr(registered({ ...base, ...override }))],
        ])
      )
      await verify(t, p.submissionId)
      expect(await submissionRow(t, p.submissionId)).toMatchObject({
        status: 'MISMATCH',
        needsReview: true,
        mismatchReason: reason,
      })
      expect((await chainRow(t, s))?.status).toBe('FAILED')
      expect(
        (
          await t.query(api.chain.articles.getArticleTipAvailability, {
            articleId: s.articleId,
          })
        ).status
      ).toBe('unregistered')
    }
  )

  it('ignores an event from another contract', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await submit(t, s, p.submissionId, HASH)
    stubRpc(() =>
      successResponse(HASH, [
        [
          eventXdr({
            ...registered({
              articleKey: p.articleKey,
              author: AUTHOR,
              articleRef: p.articleRef!,
              contentHash: p.contentHash!,
            }),
            contractId: OTHER_CONTRACT,
          }),
        ],
      ])
    )
    await verify(t, p.submissionId)
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'no_event',
    })
  })

  it('marks FAILED when RPC reports the transaction failed, so the author can retry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await submit(t, s, p.submissionId, HASH)
    stubRpc(() => failedResponse(HASH))
    await verify(t, p.submissionId)
    expect((await submissionRow(t, p.submissionId))?.status).toBe('FAILED')
    expect((await chainRow(t, s))?.status).toBe('FAILED')
    const view = await as(t, s.authorId).query(
      api.chain.articles.getRegistration,
      { articleId: s.articleId }
    )
    expect(view?.submission).toMatchObject({ status: 'FAILED', canRetry: true })
    expect((await prepare(t, s)).existing).toBe(false)
  })

  it('keeps waiting while RPC has not seen the transaction', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await submit(t, s, p.submissionId, HASH)
    stubRpc(() => notFoundResponse(HASH))
    expect(await verify(t, p.submissionId)).toBe('not_found')
    expect((await submissionRow(t, p.submissionId))?.status).toBe('SUBMITTED')
    expect((await chainRow(t, s))?.status).toBe('SUBMITTED')
  })

  it('confirms from the indexed event (rule (b)) without a recorded hash', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        rpcEvent(
          registered({
            articleKey: p.articleKey,
            author: AUTHOR,
            articleRef: p.articleRef!,
            contentHash: p.contentHash!,
          }),
          HASH2,
          6_000_200
        ),
      ],
    })
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      status: 'CONFIRMED',
      txHash: HASH2,
    })
    expect(await chainRow(t, s)).toMatchObject({
      status: 'REGISTERED',
      registeredLedger: 6_000_200,
    })
  })

  it('flags, but does not confirm, an event after the client reported failure', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await as(t, s.authorId).mutation(api.chain.submissions.recordSendFailed, {
      submissionId: p.submissionId,
      reason: 'send_error',
    })
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        rpcEvent(
          registered({
            articleKey: p.articleKey,
            author: AUTHOR,
            articleRef: p.articleRef!,
            contentHash: p.contentHash!,
          }),
          HASH2
        ),
      ],
    })
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      status: 'FAILED',
      needsReview: true,
      lastError: 'event_after_failure',
    })
    // Core holds the registration, so the article mirrors it.
    expect((await chainRow(t, s))?.status).toBe('REGISTERED')
  })
})

describe('content update', () => {
  it('re-anchors a registered article with the next content version', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await registerArticle(t, s)
    expect(
      await codeOf(
        as(t, s.authorId).mutation(api.chain.articles.prepareContentUpdate, {
          articleId: s.articleId,
          requestId: rid(),
        })
      )
    ).toBe('NOTHING_TO_UPDATE')

    await t.run((ctx) =>
      ctx.db.patch(s.articleId, {
        contentHash: UPDATED_HASH,
        contentVersion: 2,
      })
    )
    const view = await as(t, s.authorId).query(
      api.chain.articles.getRegistration,
      { articleId: s.articleId }
    )
    expect(view?.contentOutdated).toBe(true)

    const p = await as(t, s.authorId).mutation(
      api.chain.articles.prepareContentUpdate,
      { articleId: s.articleId, requestId: rid() }
    )
    expect(p).toMatchObject({
      kind: 'content_update',
      signer: AUTHOR,
      contentHash: UPDATED_HASH,
      arweaveId: null,
    })
    await submit(t, s, p.submissionId, HASH2)
    stubRpc(() =>
      successResponse(HASH2, [
        [
          eventXdr(
            contentUpdated({
              articleKey: p.articleKey,
              contentHash: UPDATED_HASH,
              contentVersion: 2,
            })
          ),
        ],
      ])
    )
    await verify(t, p.submissionId)
    expect((await submissionRow(t, p.submissionId))?.status).toBe('CONFIRMED')
    expect(await chainRow(t, s)).toMatchObject({
      contentHash: UPDATED_HASH,
      contentVersion: 2,
      status: 'REGISTERED',
    })
  })

  it('flags a content version that differs from the expected one', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await registerArticle(t, s)
    await t.run((ctx) =>
      ctx.db.patch(s.articleId, { contentHash: UPDATED_HASH })
    )
    const p = await as(t, s.authorId).mutation(
      api.chain.articles.prepareContentUpdate,
      { articleId: s.articleId, requestId: rid() }
    )
    await submit(t, s, p.submissionId, HASH2)
    stubRpc(() =>
      successResponse(HASH2, [
        [
          eventXdr(
            contentUpdated({
              articleKey: p.articleKey,
              contentHash: UPDATED_HASH,
              contentVersion: 3,
            })
          ),
        ],
      ])
    )
    await verify(t, p.submissionId)
    expect(await submissionRow(t, p.submissionId)).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:content_version',
      needsReview: true,
    })
    expect((await chainRow(t, s))?.contentVersion).toBe(1)
  })

  it('refuses before registration and from another wallet', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const update = () =>
      as(t, s.authorId).mutation(api.chain.articles.prepareContentUpdate, {
        articleId: s.articleId,
        requestId: rid(),
      })
    expect(await codeOf(update())).toBe('NOT_REGISTERED')
    await registerArticle(t, s)
    await t.run(async (ctx) => {
      await ctx.db.patch(s.articleId, { contentHash: UPDATED_HASH })
      await ctx.db.patch(s.authorId, { stellarAddress: NEW_WALLET })
    })
    expect(await codeOf(update())).toBe('WRONG_SIGNER')
  })
})

describe('author change', () => {
  async function moveSetup() {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const reg = await registerArticle(t, s)
    await t.run((ctx) =>
      ctx.db.patch(s.authorId, { stellarAddress: NEW_WALLET })
    )
    return { t, s, reg }
  }

  it('proposes with the old address and accepts with the new one', async () => {
    const { t, s, reg } = await moveSetup()
    const before = await as(t, s.authorId).query(
      api.chain.articles.getRegistration,
      { articleId: s.articleId }
    )
    expect(before?.payoutOutdated).toBe(true)
    expect(
      (
        await t.query(api.chain.articles.getArticleTipAvailability, {
          articleId: s.articleId,
        })
      ).status
    ).toBe('payout_outdated')
    expect(
      await codeOf(
        as(t, s.authorId).mutation(api.chain.articles.prepareAuthorAccept, {
          articleId: s.articleId,
          requestId: rid(),
        })
      )
    ).toBe('NO_PENDING_AUTHOR')

    const propose = await as(t, s.authorId).mutation(
      api.chain.articles.prepareAuthorProposal,
      { articleId: s.articleId, requestId: rid(), currentLedger: 6_000_500 }
    )
    expect(propose).toMatchObject({
      kind: 'author_propose',
      signer: AUTHOR,
      newAuthor: NEW_WALLET,
      liveUntilLedger: 6_000_500 + 7 * 17_280,
      articleKey: reg.articleKey,
    })
    await submit(t, s, propose.submissionId, HASH2)
    stubRpc(() =>
      successResponse(HASH2, [
        [
          eventXdr(
            proposed({
              articleKey: reg.articleKey,
              newAuthor: NEW_WALLET,
              liveUntil: propose.liveUntilLedger!,
            })
          ),
        ],
      ])
    )
    await verify(t, propose.submissionId)
    expect((await submissionRow(t, propose.submissionId))?.status).toBe(
      'CONFIRMED'
    )
    expect((await chainRow(t, s))?.pendingAuthor).toBe(NEW_WALLET)

    const accept = await as(t, s.authorId).mutation(
      api.chain.articles.prepareAuthorAccept,
      { articleId: s.articleId, requestId: rid() }
    )
    expect(accept).toMatchObject({
      kind: 'author_accept',
      signer: NEW_WALLET,
      newAuthor: NEW_WALLET,
      author: AUTHOR,
    })
    const ACCEPT_HASH = 'e5'.repeat(32)
    await submit(t, s, accept.submissionId, ACCEPT_HASH)
    stubRpc(() =>
      successResponse(ACCEPT_HASH, [
        [
          eventXdr(
            changed({
              articleKey: reg.articleKey,
              previous: AUTHOR,
              next: NEW_WALLET,
            })
          ),
        ],
      ])
    )
    await verify(t, accept.submissionId)
    expect(await chainRow(t, s)).toMatchObject({
      authorAddress: NEW_WALLET,
      // The article ID never changes after registration.
      articleKey: reg.articleKey,
    })
    expect((await chainRow(t, s))?.pendingAuthor).toBeUndefined()
    expect(
      (
        await t.query(api.chain.articles.getArticleTipAvailability, {
          articleId: s.articleId,
        })
      ).status
    ).toBe('registered')
  })

  it('moves the first split share to the new author from the indexed event', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const splits = [
      { recipient: AUTHOR, bps: 6_000 },
      { recipient: COAUTHOR, bps: 4_000 },
    ]
    const p = await prepare(t, s, splits)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        rpcEvent(
          registered({
            articleKey: p.articleKey,
            author: AUTHOR,
            articleRef: p.articleRef!,
            contentHash: p.contentHash!,
            splits,
          }),
          HASH,
          6_000_001
        ),
        rpcEvent(
          changed({
            articleKey: p.articleKey,
            previous: AUTHOR,
            next: NEW_WALLET,
          }),
          HASH2,
          6_000_002
        ),
      ],
    })
    expect((await chainRow(t, s))?.splits).toEqual([
      { recipient: NEW_WALLET, bps: 6_000 },
      { recipient: COAUTHOR, bps: 4_000 },
    ])
  })

  it('refuses to propose the address already registered or a co-author', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await registerArticle(t, s)
    const propose = () =>
      as(t, s.authorId).mutation(api.chain.articles.prepareAuthorProposal, {
        articleId: s.articleId,
        requestId: rid(),
        currentLedger: 6_000_500,
      })
    expect(await codeOf(propose())).toBe('SAME_AUTHOR')
  })

  it('refuses an accept signed by an address that was not proposed', async () => {
    const { t, s, reg } = await moveSetup()
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        rpcEvent(
          proposed({
            articleKey: reg.articleKey,
            newAuthor: COAUTHOR,
            liveUntil: 6_100_000,
          }),
          HASH2
        ),
      ],
    })
    expect(
      await codeOf(
        as(t, s.authorId).mutation(api.chain.articles.prepareAuthorAccept, {
          articleId: s.articleId,
          requestId: rid(),
        })
      )
    ).toBe('NO_PENDING_AUTHOR')
  })
})

describe('getRegistration', () => {
  it('shows the owner the wallet state and nothing to others', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { verified: false })
    const mine = await as(t, s.authorId).query(
      api.chain.articles.getRegistration,
      { articleId: s.articleId }
    )
    expect(mine).toMatchObject({
      v2Enabled: true,
      wallet: { state: 'unverified', address: null },
      registration: null,
      submission: null,
    })
    expect(
      await as(t, s.otherId).query(api.chain.articles.getRegistration, {
        articleId: s.articleId,
      })
    ).toBeNull()
  })
})

describe('recheck', () => {
  it('expires an unsent registration once the indexer covers its time bound', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await t.run((ctx) =>
      ctx.db.insert('chainCursor', {
        network: 'TESTNET',
        chainEpoch: 'testnet-test',
        lastLedger: 6_000_000,
        lastLedgerCloseTime: p.maxTime + 60,
        latestLedger: 6_000_000,
        oldestLedger: 5_900_000,
        lagLedgers: 0,
        status: 'OK',
        updatedAt: Date.now(),
      })
    )
    await t.mutation(internal.chain.submissions.resolveUnfound, {
      submissionId: p.submissionId,
    })
    expect((await submissionRow(t, p.submissionId))?.status).toBe('EXPIRED')
    expect((await chainRow(t, s))?.status).toBe('FAILED')
  })

  it('confirms from the article state the indexer already applied', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await submit(t, s, p.submissionId, HASH)
    const row = await chainRow(t, s)
    await t.run((ctx) =>
      ctx.db.patch(row!._id, { status: 'REGISTERED', txHash: HASH })
    )
    await t.mutation(internal.chain.submissions.resolveUnfound, {
      submissionId: p.submissionId,
    })
    expect((await submissionRow(t, p.submissionId))?.status).toBe('CONFIRMED')
  })
})
