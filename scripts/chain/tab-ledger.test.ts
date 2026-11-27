/// <reference types="vite/client" />
/**
 * Tab ledger and voucher acceptance (#447). The reader, writer, keys, tab
 * contract, network and receipts come from `contracts/shared/test-vectors.json`,
 * so a full three-tip sequence must reproduce the Rust voucher payload,
 * receipts root and acceptance signature byte for byte (I-23).
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'buffer'
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import {
  DAY_LEDGERS,
  SETTLE_GRACE_LEDGERS,
  netOf,
} from '../../convex/lib/chain/tabLedger'
import {
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  verifyEd25519,
  voucherPayloadBytes,
  acceptancePayloadBytes,
  type StoredReceipt,
} from '../../convex/lib/chain/voucher'
import { hexToBytes, bytesToHex } from '../../convex/lib/chain/ids'
import { signEd25519 } from '../../lib/stellar/v2/tab/encoding'
import {
  commitAcceptedTip,
  signTabTip,
  type SessionKeyScope,
} from '../../lib/stellar/v2/tab'
import { depsFor, freshDb, plantKey } from '../tab/helpers'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { seedAddress } from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const EPOCH = 'testnet-tab'
const PASSPHRASE = shared.network.passphrase
const TAB = shared.tab_contract
const TOKEN = 'CAJS4RVGLFL2ANWW7W6Q4RGOZQXSVXW5BQKJ7A3ISE4EOUM5HHO77CQL'
const READER = shared.vouchers[0]!.reader
const WRITER = shared.vouchers[0]!.writer
const CLIENT_SCOPE: SessionKeyScope = {
  tabContractId: TAB,
  readerAddress: READER,
}
const OTHER_WRITER = seedAddress(41)
const SESSION_SEED = hexToBytes(shared.keys.session.seed)
const SESSION_PUBLIC = shared.keys.session.public_key
const ACCEPTOR_PUBLIC = shared.keys.acceptor.public_key
const VECTOR_RECEIPTS = shared.receipts.items
const HIGHLIGHT = {
  text: 'The quick brown fox jumps over the lazy dog',
  startOffset: 120,
  endOffset: 163,
}
const LEDGER = 7_000_000
const VALID_UNTIL = LEDGER + 7 * DAY_LEDGERS
const T0 = Date.UTC(2026, 11, 2, 12, 0, 0)
const XLM = BigInt(10_000_000)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: PASSPHRASE,
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    TAB_CONTRACT_ID: TAB,
    TOKEN_CONTRACT_ID: TOKEN,
    SETTLEMENT_ENABLED: 'true',
    TAB_ACCEPTOR_SECRET: shared.keys.acceptor.seed,
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

type T = ReturnType<typeof convexTest>

// ---------------------------------------------------------------------------
// Fixtures

let eventSeq = 0

function eventId(ledger: number): string {
  eventSeq += 1
  return rpcEventId(ledger, eventSeq, 0, 0)
}

type ScEntry = [string, xdr.ScVal]

/** A Tab event in the `getEvents` shape: topics, then a map of fields. */
function tabEvent(
  name: string,
  topics: string[],
  entries: ScEntry[],
  options: { ledger?: number; id?: string } = {}
): RawRpcEvent {
  const ledger = options.ledger ?? LEDGER
  const map = xdr.ScVal.scvMap(
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(
        ([key, val]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
      )
  )
  return {
    type: 'contract',
    ledger,
    ledgerClosedAt: new Date(T0).toISOString(),
    contractId: TAB,
    id: options.id ?? eventId(ledger),
    txHash: 'ab'.repeat(32),
    topic: [
      xdr.ScVal.scvSymbol(name).toXdr('base64'),
      ...topics.map((a) => new Address(a).toScVal().toXdr('base64')),
    ],
    value: map.toXdr('base64'),
    inSuccessfulContractCall: true,
  }
}

const i128 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: 'i128' })
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })
const bytes = (h: string) => xdr.ScVal.scvBytes(Buffer.from(hexToBytes(h)))

const ev = {
  deposited: (reader: string, amount: bigint, balanceAfter: bigint, o = {}) =>
    tabEvent(
      'deposited',
      [reader],
      [
        ['amount', i128(amount)],
        ['balance_after', i128(balanceAfter)],
      ],
      o
    ),
  keyRegistered: (
    reader: string,
    keyId: number,
    validUntil = VALID_UNTIL,
    spendLimit = BigInt(50) * XLM,
    o = {}
  ) =>
    tabEvent(
      'key_registered',
      [reader],
      [
        ['key_id', u32(keyId)],
        ['public_key', bytes(SESSION_PUBLIC)],
        ['valid_until', u32(validUntil)],
        ['spend_limit', i128(spendLimit)],
      ],
      o
    ),
  keyRevoked: (reader: string, keyId: number, validUntil: number, o = {}) =>
    tabEvent(
      'key_revoked',
      [reader],
      [
        ['key_id', u32(keyId)],
        ['valid_until', u32(validUntil)],
      ],
      o
    ),
  tabSettled: (
    f: {
      keyId?: number
      cumulative: bigint
      paidAfter: bigint
      gross: bigint
      fee?: bigint
      writer?: string
    },
    o = {}
  ) =>
    tabEvent(
      'tab_settled',
      [READER, f.writer ?? WRITER],
      [
        ['key_id', u32(f.keyId ?? 0)],
        ['cumulative', i128(f.cumulative)],
        ['paid_after', i128(f.paidAfter)],
        ['gross', i128(f.gross)],
        ['fee', i128(f.fee ?? BigInt(0))],
        ['receipts_root', bytes('00'.repeat(32))],
        ['by_writer', xdr.ScVal.scvBool(false)],
      ],
      o
    ),
  voucherSkipped: (cumulative: bigint, reason: number, o = {}) =>
    tabEvent(
      'voucher_skipped',
      [READER, WRITER],
      [
        ['key_id', u32(0)],
        ['cumulative', i128(cumulative)],
        ['reason', u32(reason)],
      ],
      o
    ),
  withdrawStarted: (balance: bigint, unlock: number, o = {}) =>
    tabEvent(
      'withdraw_started',
      [READER],
      [
        ['balance', i128(balance)],
        ['unlock_ledger', u32(unlock)],
      ],
      o
    ),
  withdrawCancelled: (balance: bigint, o = {}) =>
    tabEvent('withdraw_cancelled', [READER], [['balance', i128(balance)]], o),
  withdrawn: (amount: bigint, o = {}) =>
    tabEvent('withdrawn', [READER], [['amount', i128(amount)]], o),
  claimed: (recipient: string, amount: bigint, o = {}) =>
    tabEvent('claimed', [recipient], [['amount', i128(amount)]], o),
}

async function ingest(t: T, ...events: RawRpcEvent[]) {
  return t.mutation(internal.chain.indexer.ingestBackfill, { events })
}

async function setLedger(t: T, latestLedger: number) {
  await t.run(async (ctx) => {
    const cursor = await ctx.db.query('chainCursor').first()
    await ctx.db.patch(cursor!._id, { latestLedger, updatedAt: Date.now() })
  })
}

/** Users, a registered article, config, cursor, price, and an open tab. */
async function seed(t: T, options: { open?: boolean } = {}) {
  const now = Date.now()
  const ids = await t.run(async (ctx) => {
    const db = ctx.db
    const verified = {
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: PASSPHRASE,
    }
    const readerId = await db.insert('users', {
      username: 'reader',
      email: 'reader@example.test',
      stellarAddress: READER,
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: WRITER,
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const otherAuthorId = await db.insert('users', {
      username: 'other',
      email: 'other@example.test',
      stellarAddress: OTHER_WRITER,
      ...verified,
      createdAt: now,
      updatedAt: now,
    })
    const article = (authorId: Id<'users'>, slug: string) =>
      db.insert('articles', {
        slug,
        title: slug,
        content: { type: 'doc', content: [] },
        published: true,
        authorId,
        authorUsername: 'writer',
        createdAt: now,
        updatedAt: now,
      })
    const articleId = await article(authorId, 'on-writing-well')
    const otherArticleId = await article(otherAuthorId, 'other-article')
    const unregisteredId = await article(authorId, 'not-registered')
    const register = (
      articleId: Id<'articles'>,
      articleKey: string,
      authorAddress: string
    ) =>
      db.insert('chainArticles', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        articleId,
        articleKey,
        authorAddress,
        contentHash: VECTOR_RECEIPTS[0]!.content_hash,
        contentVersion: 1,
        splits: [],
        totals: {},
        status: 'REGISTERED',
        updatedAt: now,
      })
    const chainArticleId = await register(
      articleId,
      VECTOR_RECEIPTS[0]!.article_id,
      WRITER
    )
    await register(otherArticleId, 'cd'.repeat(32), OTHER_WRITER)
    await db.insert('chainConfig', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      tabContractId: TAB,
      tokenContractId: TOKEN,
      minTip: '100000',
      feeBps: 250,
      tabAcceptorKeys: [ACCEPTOR_PUBLIC],
      paused: {},
      refreshedAt: now,
    })
    await db.insert('chainCursor', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      lastLedger: LEDGER,
      lastLedgerCloseTime: Math.floor(now / 1000),
      latestLedger: LEDGER,
      oldestLedger: LEDGER - 100_000,
      lagLedgers: 0,
      status: 'OK',
      updatedAt: now,
    })
    // $1 per XLM: 10, 25 and 4 cents are the vector amounts.
    await db.insert('xlmPriceCache', {
      priceUsd: 1,
      source: 'test',
      fetchedAt: now,
    })
    return {
      readerId,
      authorId,
      otherAuthorId,
      articleId,
      otherArticleId,
      unregisteredId,
      chainArticleId,
    }
  })
  if (options.open !== false) {
    await ingest(t, ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM))
    await ingest(t, ev.keyRegistered(READER, 0))
  }
  return ids
}

type Seeded = Awaited<ReturnType<typeof seed>>

const as = (t: T, userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

/** Makes `newClientRefHex` return the vector client refs in order. */
function useVectorClientRefs() {
  const queue = VECTOR_RECEIPTS.map((r) => hexToBytes(r.client_ref))
  const original = crypto.getRandomValues.bind(crypto)
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((
    array: Uint8Array
  ) => {
    if (array instanceof Uint8Array && array.length === 16 && queue.length) {
      array.set(queue.shift()!)
      return array
    }
    return original(array as Uint8Array)
  }) as typeof crypto.getRandomValues)
}

let requestSeq = 0

type Prepared = {
  prepareId: Id<'tips'> | Id<'highlightTips'>
  receipt: StoredReceipt
  leafHashes: string[]
  writer: string
  keyId: number
  tabContractId: string
}

async function prepare(
  t: T,
  s: Seeded,
  o: {
    cents?: number
    articleId?: Id<'articles'>
    highlight?: typeof HIGHLIGHT
    userId?: Id<'users'>
    keyId?: number
    requestId?: string
  } = {}
): Promise<Prepared> {
  return (await as(t, o.userId ?? s.readerId).mutation(api.tabs.prepareTip, {
    requestId: o.requestId ?? `req-${++requestSeq}`,
    articleId: o.articleId ?? s.articleId,
    amountCents: o.cents ?? 10,
    keyId: o.keyId ?? 0,
    ...(o.highlight ? { highlight: o.highlight } : {}),
  })) as Prepared
}

/** The client side of 5.6 step 2: new root, payload, session signature. */
function sign(p: Prepared, reader = READER, seed = SESSION_SEED) {
  const leaves = [...p.leafHashes, receiptLeafHex(p.receipt)]
  const payload = voucherPayloadBytes({
    tab: p.tabContractId,
    networkId: networkIdOf(PASSPHRASE),
    reader,
    writer: p.writer,
    keyId: p.keyId,
    publicKey: hexToBytes(SESSION_PUBLIC),
    cumulative: BigInt(p.receipt.cumulativeAfter),
    receiptsRoot: hexToBytes(receiptsRootHex(leaves)),
  })
  return bytesToHex(signEd25519(seed, payload))
}

async function submit(
  t: T,
  s: Seeded,
  p: Prepared,
  o: { signature?: string; receipt?: StoredReceipt; userId?: Id<'users'> } = {}
) {
  return as(t, o.userId ?? s.readerId).mutation(api.tabs.submitTip, {
    prepareId: p.prepareId,
    receipt: o.receipt ?? p.receipt,
    signature: o.signature ?? sign(p),
  })
}

async function tip(t: T, s: Seeded, o: Parameters<typeof prepare>[2] = {}) {
  return submit(t, s, await prepare(t, s, o))
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: unknown }).data
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    return (parsed as { code?: string })?.code ?? String(error)
  }
  return 'no error'
}

async function account(t: T) {
  return t.run(async (ctx) => (await ctx.db.query('tabAccounts').first())!)
}
async function voucherRow(t: T, writer = WRITER) {
  return t.run(
    async (ctx) =>
      (await ctx.db.query('tabVouchers').collect()).find(
        (row) => row.writerAddress === writer
      )!
  )
}
async function receiptStatuses(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query('tabReceipts').collect())
      .sort((a, b) => a.seq - b.seq)
      .map((r) => r.status)
  )
}
async function earnings(t: T, userId: Id<'users'>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('authorEarnings').collect()).find(
      (row) => row.userId === userId
    )
  )
}

// ---------------------------------------------------------------------------

describe('acceptance against the shared vectors', () => {
  it('accepts three tips and reproduces the Rust voucher, root and acceptance', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    useVectorClientRefs()

    const results = []
    for (const [i, o] of [
      { cents: 10 },
      { cents: 25, highlight: HIGHLIGHT },
      { cents: 4 },
    ].entries()) {
      const p = await prepare(t, s, o)
      expect(p.receipt).toEqual({
        amount: VECTOR_RECEIPTS[i]!.amount,
        articleId: VECTOR_RECEIPTS[i]!.article_id,
        clientRef: VECTOR_RECEIPTS[i]!.client_ref,
        contentHash: VECTOR_RECEIPTS[i]!.content_hash,
        cumulativeAfter: VECTOR_RECEIPTS[i]!.cumulative_after,
        highlightId: VECTOR_RECEIPTS[i]!.highlight_id,
        seq: VECTOR_RECEIPTS[i]!.seq,
      })
      expect(p.leafHashes).toEqual(
        VECTOR_RECEIPTS.slice(0, i).map((r) => r.leaf)
      )
      const result = await submit(t, s, p)
      expect(result.receipt).toEqual(p.receipt)
      expect(result.voucher.receiptsRoot).toBe(shared.receipts.roots[i]!.root)
      results.push(result)
    }

    const final = results[2]!
    const vector = shared.vouchers[0]!
    expect(final.voucher).toMatchObject({
      tabContractId: TAB,
      reader: READER,
      writer: WRITER,
      keyId: 0,
      cumulative: vector.cumulative,
      receiptsRoot: vector.receipts_root,
      signature: vector.signature,
      acceptor: ACCEPTOR_PUBLIC,
      acceptanceSignature: vector.acceptance_signature,
    })
    expect(final.leafHashes).toEqual(VECTOR_RECEIPTS.map((r) => r.leaf))

    const v = await voucherRow(t)
    expect(v).toMatchObject({
      cumulative: '3900000',
      seq: 3,
      receiptsRoot: vector.receipts_root,
      leafHashes: VECTOR_RECEIPTS.map((r) => r.leaf),
      paidOnChain: '0',
      unsettled: true,
      state: 'ACTIVE',
      pendingNet: netOf(BigInt(3_900_000)).toString(),
    })
    const a = await account(t)
    expect(a.outstanding).toBe('3900000')
    expect(a.acceptedToday).toBe('3900000')
    const tips = await t.run(async (ctx) => ({
      tips: await ctx.db.query('tips').collect(),
      highlights: await ctx.db.query('highlightTips').collect(),
    }))
    expect(tips.tips.map((r) => [r.status, r.channel])).toEqual([
      ['ACCEPTED', 'tab'],
      ['ACCEPTED', 'tab'],
    ])
    expect(tips.highlights[0]).toMatchObject({
      status: 'ACCEPTED',
      channel: 'tab',
      highlightId: shared.identifiers.highlight_ids[0]!.v1_convex_id,
      chainHighlightKey: shared.identifiers.highlight_ids[0]!.highlight_id,
    })
    expect((await earnings(t, s.authorId))?.pendingBaseUnits).toEqual({
      [TOKEN]: netOf(BigInt(3_900_000)).toString(),
    })

    // The writer's download verifies under both keys.
    const download = await as(t, s.authorId).query(
      api.tabs.getLatestVouchersForWriter,
      {}
    )
    const latest = download!.vouchers[0]!
    const payload = voucherPayloadBytes({
      tab: latest.tabContractId,
      networkId: networkIdOf(download!.networkPassphrase),
      reader: latest.reader,
      writer: latest.writer,
      keyId: latest.keyId,
      publicKey: hexToBytes(latest.publicKey),
      cumulative: BigInt(latest.cumulative),
      receiptsRoot: hexToBytes(latest.receiptsRoot),
    })
    expect(bytesToHex(payload)).toBe(vector.payload_xdr)
    expect(verifyEd25519(latest.publicKey, payload, latest.signature)).toBe(
      true
    )
    expect(bytesToHex(acceptancePayloadBytes(payload))).toBe(
      vector.acceptance_payload_xdr
    )
  })

  it('builds the Merkle root of the vector receipts', () => {
    const leaves = VECTOR_RECEIPTS.map((r) =>
      receiptLeafHex({
        amount: r.amount,
        articleId: r.article_id,
        clientRef: r.client_ref,
        contentHash: r.content_hash,
        cumulativeAfter: r.cumulative_after,
        highlightId: r.highlight_id,
        seq: r.seq,
      })
    )
    expect(leaves).toEqual(VECTOR_RECEIPTS.map((r) => r.leaf))
    for (const root of shared.receipts.roots) {
      expect(receiptsRootHex(leaves.slice(0, root.count))).toBe(root.root)
    }
  })
})

describe('the browser tab library', () => {
  it('signs prepared tips that Convex accepts, and keeps its ledger in step', async () => {
    // fake-indexeddb runs its callbacks on timers; fake only the clock.
    vi.useRealTimers()
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    const t = convexTest(schema, modules)
    const s = await seed(t)
    useVectorClientRefs()
    const db = freshDb()
    await plantKey(db, CLIENT_SCOPE, SESSION_SEED, 'noble', [0])
    const deps = depsFor(db, { now: () => Date.now() })

    let last: Awaited<ReturnType<typeof submit>> | null = null
    for (const [i, o] of [
      { cents: 10 },
      { cents: 25, highlight: HIGHLIGHT },
      { cents: 4 },
    ].entries()) {
      // The real prepareTip result type, not the suite's narrowed `Prepared`.
      const p = await as(t, s.readerId).mutation(api.tabs.prepareTip, {
        requestId: `lib-${i}`,
        articleId: s.articleId,
        amountCents: o.cents,
        keyId: 0,
        ...(o.highlight ? { highlight: o.highlight } : {}),
      })
      const signed = await signTabTip(p, deps)
      if (signed.kind !== 'signed')
        throw new Error(`not signed: ${signed.kind}`)
      const accepted = await as(t, s.readerId).mutation(
        api.tabs.submitTip,
        signed.submit
      )
      expect(accepted.status).toBe('ACCEPTED')
      expect(accepted.voucher.receiptsRoot).toBe(signed.voucher.receiptsRoot)
      expect((await commitAcceptedTip(accepted, deps)).status).toBe('committed')
      last = accepted
    }

    const vector = shared.vouchers[0]!
    expect(last!.voucher).toMatchObject({
      signature: vector.signature,
      acceptanceSignature: vector.acceptance_signature,
      receiptsRoot: vector.receipts_root,
    })
    expect(await deps.ledger.read(CLIENT_SCOPE, 0, WRITER)).toMatchObject({
      committed: {
        seq: 3,
        cumulative: vector.cumulative,
        leafHashes: VECTOR_RECEIPTS.map((r) => r.leaf),
      },
    })
  })
})

describe('rejections', () => {
  it('refuses a bad signature and a payload with the wrong domain', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    const bad = sign({ ...p, receipt: { ...p.receipt, cumulativeAfter: '1' } })
    expect(await errorCode(submit(t, s, p, { signature: bad }))).toBe(
      'TAB_INVALID_SIGNATURE'
    )

    // Same fields, signed under another domain symbol.
    const leaves = [...p.leafHashes, receiptLeafHex(p.receipt)]
    const entries: ScEntry[] = [
      ['cumulative', i128(BigInt(p.receipt.cumulativeAfter))],
      ['domain', xdr.ScVal.scvSymbol('quilltip_tab_v0')],
      ['key_id', u32(0)],
      ['network_id', xdr.ScVal.scvBytes(Buffer.from(networkIdOf(PASSPHRASE)))],
      ['public_key', bytes(SESSION_PUBLIC)],
      ['reader', new Address(READER).toScVal()],
      ['receipts_root', bytes(receiptsRootHex(leaves))],
      ['tab', new Address(TAB).toScVal()],
      ['writer', new Address(WRITER).toScVal()],
    ]
    const wrongDomain = xdr.ScVal.scvMap(
      entries.map(
        ([key, val]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
      )
    ).toXdr()
    const signature = bytesToHex(signEd25519(SESSION_SEED, wrongDomain))
    expect(await errorCode(submit(t, s, p, { signature }))).toBe(
      'TAB_INVALID_SIGNATURE'
    )
    // Another key over the right bytes.
    const otherKey = sign(p, READER, new Uint8Array(32).fill(9))
    expect(await errorCode(submit(t, s, p, { signature: otherKey }))).toBe(
      'TAB_INVALID_SIGNATURE'
    )
    expect((await account(t)).outstanding).toBe('0')
  })

  it('refuses an expiring, revoked or unknown key', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(await errorCode(prepare(t, s, { keyId: 7 }))).toBe('TAB_KEY_UNKNOWN')

    const p = await prepare(t, s)
    // One day before valid_until, acceptance stops (section 3.5, item 4).
    await setLedger(t, VALID_UNTIL - DAY_LEDGERS)
    expect(await errorCode(submit(t, s, p))).toBe('TAB_KEY_EXPIRED')
    await setLedger(t, VALID_UNTIL - DAY_LEDGERS - 1)
    await submit(t, s, p)

    await ingest(t, ev.keyRevoked(READER, 0, LEDGER + 10))
    expect(await errorCode(prepare(t, s))).toBe('TAB_KEY_REVOKED')
  })

  it('stops accepting under a key revoked in the app', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await as(t, s.readerId).mutation(api.tabs.prepareRevokeKey, { keyId: 0 })
    expect(await errorCode(submit(t, s, p))).toBe('TAB_KEY_REVOKED')
  })

  it('requires the prepared seq and cumulative (strictly monotonic)', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const first = await prepare(t, s)
    const second = await prepare(t, s)
    expect(second.receipt.seq).toBe(1)
    await submit(t, s, first)
    // The second was prepared for seq 1; the pair is now at seq 1.
    expect(await errorCode(submit(t, s, second))).toBe('TAB_STALE_PREPARE')

    // A client cannot change the receipt: a lower or equal cumulative.
    const third = await prepare(t, s)
    expect(third.receipt).toMatchObject({ seq: 2, cumulativeAfter: '2000000' })
    const lower = { ...third.receipt, cumulativeAfter: '1000000' }
    expect(
      await errorCode(
        submit(t, s, third, {
          receipt: lower,
          signature: sign({ ...third, receipt: lower }),
        })
      )
    ).toBe('TAB_RECEIPT_MISMATCH')
    await submit(t, s, third)
    expect((await voucherRow(t)).cumulative).toBe('2000000')
  })

  it('refuses tips above the balance minus outstanding', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, BigInt(1_500_000), BigInt(1_500_000)))
    await ingest(t, ev.keyRegistered(READER, 0))
    await tip(t, s, { cents: 10 })
    expect(await errorCode(prepare(t, s, { cents: 10 }))).toBe(
      'TAB_OVER_BALANCE'
    )
    await tip(t, s, { cents: 5 })
    expect((await account(t)).outstanding).toBe('1500000')
  })

  it('refuses tips while a withdrawal is pending, and resumes after a deposit', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await ingest(
      t,
      ev.withdrawStarted(BigInt(10) * XLM, LEDGER + 3 * DAY_LEDGERS)
    )
    expect((await account(t)).status).toBe('CLOSING')
    expect(await errorCode(submit(t, s, p))).toBe('TAB_CLOSING')
    expect(await errorCode(prepare(t, s))).toBe('TAB_CLOSING')
    await ingest(
      t,
      ev.withdrawCancelled(BigInt(10) * XLM),
      ev.deposited(READER, XLM, BigInt(11) * XLM)
    )
    expect(await account(t)).toMatchObject({
      status: 'OPEN',
      confirmedBalance: (BigInt(11) * XLM).toString(),
    })
    await tip(t, s)
  })

  it('applies the minimum, the per-tip maximum, the daily limit and the key limit', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, BigInt(100) * XLM, BigInt(100) * XLM))
    await ingest(t, ev.keyRegistered(READER, 0, VALID_UNTIL, BigInt(12) * XLM))
    expect(await errorCode(prepare(t, s, { cents: 0 }))).toBe(
      'TAB_INVALID_AMOUNT'
    )
    // 0.09 XLM: below the 0.1 XLM Core minimum.
    await t.run(async (ctx) => {
      const c = await ctx.db.query('chainConfig').first()
      await ctx.db.patch(c!._id, { minTip: '1000001' })
    })
    expect(await errorCode(prepare(t, s, { cents: 10 }))).toBe(
      'TAB_BELOW_MINIMUM'
    )
    await t.run(async (ctx) => {
      const c = await ctx.db.query('chainConfig').first()
      await ctx.db.patch(c!._id, { minTip: '100000' })
    })
    // TAB_TIP_MAX defaults to 5 XLM.
    expect(await errorCode(prepare(t, s, { cents: 501 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
    // Key spend limit 12 XLM.
    await tip(t, s, { cents: 500 })
    await tip(t, s, { cents: 500 })
    expect(await errorCode(prepare(t, s, { cents: 201 }))).toBe(
      'TAB_OVER_KEY_LIMIT'
    )
    // TAB_DAILY_LIMIT 20 XLM: a second key with room, 10 XLM already today.
    await ingest(t, ev.keyRegistered(READER, 1, VALID_UNTIL, BigInt(50) * XLM))
    await tip(t, s, { cents: 500, keyId: 1 })
    await tip(t, s, { cents: 500, keyId: 1 })
    expect(await errorCode(prepare(t, s, { cents: 10, keyId: 1 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
    // A new UTC day resets the daily total.
    vi.setSystemTime(T0 + 24 * 3600 * 1000)
    await setLedger(t, LEDGER + DAY_LEDGERS)
    await t.run(async (ctx) => {
      const p = await ctx.db.query('xlmPriceCache').first()
      await ctx.db.patch(p!._id, { fetchedAt: Date.now() })
    })
    await tip(t, s, { cents: 10, keyId: 1 })
  })

  it('refuses self-tips, unknown articles, articles with splits and unverified addresses', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // The writer opens a tab and tips their own article.
    await ingest(t, ev.deposited(WRITER, XLM, XLM), ev.keyRegistered(WRITER, 0))
    expect(await errorCode(prepare(t, s, { userId: s.authorId }))).toBe(
      'TAB_SELF_TIP'
    )
    expect(
      await errorCode(prepare(t, s, { articleId: s.unregisteredId }))
    ).toBe('TAB_ARTICLE_NOT_REGISTERED')
    await t.run(async (ctx) => {
      await ctx.db.patch(s.chainArticleId, {
        splits: [
          { recipient: WRITER, bps: 6000 },
          { recipient: OTHER_WRITER, bps: 4000 },
        ],
      })
    })
    expect(await errorCode(prepare(t, s))).toBe('TAB_ARTICLE_HAS_SPLITS')
    await t.run(async (ctx) => {
      await ctx.db.patch(s.chainArticleId, { splits: [] })
      await ctx.db.patch(s.authorId, { stellarAddressVerifiedAt: undefined })
    })
    expect(await errorCode(prepare(t, s))).toBe('TAB_WRITER_UNVERIFIED')
    await t.run(async (ctx) => {
      await ctx.db.patch(s.authorId, { stellarAddressVerifiedAt: Date.now() })
      await ctx.db.patch(s.readerId, { stellarAddressVerifiedNetwork: 'other' })
    })
    expect(await errorCode(prepare(t, s))).toBe('TAB_READER_UNVERIFIED')
  })

  it('is idempotent on the client reference and refuses a different voucher for it', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s, { requestId: 'same-request' })
    expect((await prepare(t, s, { requestId: 'same-request' })).prepareId).toBe(
      p.prepareId
    )
    const first = await submit(t, s, p)
    const again = await submit(t, s, p)
    expect(again).toMatchObject({
      alreadyAccepted: true,
      receiptId: first.receiptId,
      voucher: first.voucher,
    })
    const other = sign(p, READER, new Uint8Array(32).fill(3))
    expect(await errorCode(submit(t, s, p, { signature: other }))).toBe(
      'TAB_DUPLICATE_REFERENCE'
    )
    // Another user cannot reuse the request id or the prepare.
    expect(
      await errorCode(
        prepare(t, s, { requestId: 'same-request', userId: s.otherAuthorId })
      )
    ).toBe('INVALID_PREPARE')
    expect(await errorCode(submit(t, s, p, { userId: s.otherAuthorId }))).toBe(
      'TAB_PREPARE_NOT_FOUND'
    )
    expect((await account(t)).outstanding).toBe('1000000')
  })

  it('refuses an expired prepare and the 257th receipt of a pair', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    vi.setSystemTime(T0 + 301_000)
    expect(await errorCode(submit(t, s, p))).toBe('TAB_PREPARE_EXPIRED')
    vi.setSystemTime(T0)
    await tip(t, s)
    await t.run(async (ctx) => {
      const v = await ctx.db.query('tabVouchers').first()
      await ctx.db.patch(v!._id, { seq: 256 })
    })
    expect(await errorCode(prepare(t, s))).toBe('TAB_RECEIPT_CAP')
  })
})

describe('concurrency', () => {
  it('accepts only one of two racing submits for one pair', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const a = await prepare(t, s)
    const b = await prepare(t, s)
    const results = await Promise.allSettled([submit(t, s, a), submit(t, s, b)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(await errorCode(Promise.reject(rejected!.reason))).toBe(
      'TAB_STALE_PREPARE'
    )
    expect(await receiptStatuses(t)).toEqual(['ACCEPTED'])
    expect((await account(t)).outstanding).toBe('1000000')
  })

  it('never commits more than the balance across writers', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, BigInt(1_500_000), BigInt(1_500_000)))
    await ingest(t, ev.keyRegistered(READER, 0))
    const a = await prepare(t, s, { cents: 10 })
    const b = await prepare(t, s, { cents: 10, articleId: s.otherArticleId })
    const results = await Promise.allSettled([submit(t, s, a), submit(t, s, b)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(await errorCode(Promise.reject(rejected!.reason))).toBe(
      'TAB_OVER_BALANCE'
    )
    expect((await account(t)).outstanding).toBe('1000000')
  })
})

describe('event handlers', () => {
  it('mirrors deposits, keys and withdrawal events', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await as(t, s.readerId).mutation(api.tabs.prepareOpen, {
      amount: (BigInt(10) * XLM).toString(),
      publicKey: SESSION_PUBLIC,
      validUntil: VALID_UNTIL,
      spendLimit: (BigInt(50) * XLM).toString(),
      extractable: true,
    })
    await ingest(
      t,
      ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM),
      ev.keyRegistered(READER, 0)
    )
    const tab = await as(t, s.readerId).query(api.tabs.getMyTab, {})
    expect(tab).toMatchObject({
      status: 'OPEN',
      confirmedBalance: '100000000',
      available: '100000000',
      keys: [
        {
          keyId: 0,
          publicKey: SESSION_PUBLIC,
          validUntilLedger: VALID_UNTIL,
          spendLimit: '500000000',
          revoked: false,
          extractable: true,
        },
      ],
    })
    expect((await account(t)).pendingKeys).toEqual([])

    await ingest(t, ev.withdrawStarted(BigInt(10) * XLM, LEDGER + 100))
    expect(await account(t)).toMatchObject({
      status: 'CLOSING',
      withdrawUnlockLedger: LEDGER + 100,
    })
    await ingest(t, ev.withdrawn(BigInt(10) * XLM, { ledger: LEDGER + 101 }))
    expect(await account(t)).toMatchObject({
      status: 'CLOSED',
      confirmedBalance: '0',
    })
  })

  it('gives the same state for replayed and out-of-order events', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    const deposit = ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM)
    const key = ev.keyRegistered(READER, 0)
    await ingest(t, deposit, key)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })

    // Chain order: settle 1 XLM (id A), top-up (id B, absolute), settle the
    // rest (id C). Delivered C, A, B, then all three again.
    const settleA = ev.tabSettled({
      cumulative: BigInt(1_000_000),
      paidAfter: BigInt(1_000_000),
      gross: BigInt(1_000_000),
      fee: BigInt(25_000),
    })
    const topUp = ev.deposited(
      READER,
      XLM,
      BigInt(10) * XLM - BigInt(1_000_000) + XLM
    )
    const settleC = ev.tabSettled({
      cumulative: BigInt(3_500_000),
      paidAfter: BigInt(3_500_000),
      gross: BigInt(2_500_000),
      fee: BigInt(62_500),
    })
    await ingest(t, settleC)
    await ingest(t, settleA)
    await ingest(t, topUp)
    const replay = await ingest(t, settleA, topUp, settleC, deposit, key)
    expect(replay.duplicates).toBe(5)

    const expectedBalance = BigInt(11) * XLM - BigInt(3_500_000)
    expect(await account(t)).toMatchObject({
      confirmedBalance: expectedBalance.toString(),
      outstanding: '0',
      status: 'OPEN',
    })
    expect(await voucherRow(t)).toMatchObject({
      paidOnChain: '3500000',
      unsettled: false,
      earnedNet: netOf(BigInt(3_500_000)).toString(),
      pendingNet: '0',
    })
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    const key0 = await t.run(async (ctx) =>
      ctx.db.query('tabSessionKeys').first()
    )
    expect(key0).toMatchObject({
      spentOnChain: '3500000',
      acceptedTotal: '3500000',
    })
  })

  it('keeps a revocation and the lower expiry when KeyRevoked arrives first', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, XLM, XLM))
    const revokedId = eventId(LEDGER + 5)
    const registeredId = eventId(LEDGER)
    await ingest(t, ev.keyRevoked(READER, 0, LEDGER + 5, { id: revokedId }))
    await ingest(
      t,
      ev.keyRegistered(READER, 0, VALID_UNTIL, XLM, { id: registeredId })
    )
    const key = await t.run(async (ctx) =>
      ctx.db.query('tabSessionKeys').first()
    )
    expect(key).toMatchObject({
      publicKey: SESSION_PUBLIC,
      revoked: true,
      validUntilLedger: LEDGER + 5,
    })
    expect(await errorCode(prepare(t, s))).toBe('TAB_KEY_REVOKED')
  })

  it('applies a short settlement as SHORTFALL, then SETTLED, with the cumulative fee rule', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await tip(t, s, { cents: 4 })
    // 1.5 M of 3.9 M settles: receipt 1 SETTLED, 2 and 3 SHORTFALL.
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_900_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    expect(await receiptStatuses(t)).toEqual([
      'SETTLED',
      'SHORTFALL',
      'SHORTFALL',
    ])
    const paid = BigInt(1_500_000)
    const accepted = BigInt(3_900_000)
    expect(await voucherRow(t)).toMatchObject({
      unsettled: true,
      earnedNet: netOf(paid).toString(),
      pendingNet: (netOf(accepted) - netOf(paid)).toString(),
    })
    let e = await earnings(t, s.authorId)
    expect(e?.earnedBaseUnits?.[TOKEN]).toBe(netOf(paid).toString())
    expect(e?.pendingBaseUnits?.[TOKEN]).toBe(
      (netOf(accepted) - netOf(paid)).toString()
    )
    expect((await account(t)).outstanding).toBe('2400000')

    await ingest(t, ev.voucherSkipped(accepted, 4))
    expect((await voucherRow(t)).lastSkipReason).toBe('SHORTFALL')
    await ingest(
      t,
      ev.tabSettled({
        cumulative: accepted,
        paidAfter: accepted,
        gross: BigInt(2_400_000),
      })
    )
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED', 'SETTLED'])
    e = await earnings(t, s.authorId)
    expect(e?.earnedBaseUnits?.[TOKEN]).toBe(netOf(accepted).toString())
    expect(e?.pendingBaseUnits?.[TOKEN]).toBe('0')
    // Per-receipt net telescopes to the pair's net.
    const nets = await t.run(async (ctx) => [
      ...(await ctx.db.query('tips').collect()),
      ...(await ctx.db.query('highlightTips').collect()),
    ])
    expect(
      nets.reduce((sum, r) => sum + BigInt(r.netBaseUnits ?? '0'), BigInt(0))
    ).toBe(netOf(accepted))
    expect(e?.tipCount).toBe(3)
  })

  it('marks unpaid receipts UNPAID when the account closes and the key window ends', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(1_000_000),
        paidAfter: BigInt(1_000_000),
        gross: BigInt(1_000_000),
      })
    )
    await ingest(
      t,
      ev.withdrawStarted(BigInt(9) * XLM, LEDGER + 3 * DAY_LEDGERS)
    )
    // Withdrawn before the window ends: nothing is UNPAID yet.
    await ingest(
      t,
      ev.withdrawn(BigInt(9) * XLM, { ledger: LEDGER + 3 * DAY_LEDGERS })
    )
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'ACCEPTED'])
    // A skip after the window ends closes the pair.
    await ingest(
      t,
      ev.voucherSkipped(BigInt(3_500_000), 2, {
        ledger: VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1,
      })
    )
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'UNPAID'])
    expect(await voucherRow(t)).toMatchObject({
      state: 'UNPAID',
      unsettled: false,
      pendingNet: '0',
      earnedNet: netOf(BigInt(1_000_000)).toString(),
    })
    expect((await account(t)).outstanding).toBe('0')
    expect((await earnings(t, s.authorId))?.pendingBaseUnits?.[TOKEN]).toBe('0')
  })

  it('sweeps pairs whose window ended to UNPAID, also for an open tab', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s)
    expect(await t.mutation(internal.tabs.sweepUnpaid, {})).toEqual({
      closed: 0,
      more: false,
    })
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS)
    expect((await t.mutation(internal.tabs.sweepUnpaid, {})).closed).toBe(0)
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1)
    expect(await t.mutation(internal.tabs.sweepUnpaid, {})).toEqual({
      closed: 1,
      more: false,
    })
    expect(await receiptStatuses(t)).toEqual(['UNPAID'])
    expect(await account(t)).toMatchObject({ status: 'OPEN', outstanding: '0' })
    expect(await voucherRow(t)).toMatchObject({
      state: 'UNPAID',
      settleQueue: 'done',
      pendingNet: '0',
    })
  })

  it('voids unsettled receipts of a closed epoch', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s)
    expect(
      await errorCode(
        t.mutation(internal.tabs.voidResetEpoch, { chainEpoch: EPOCH })
      )
    ).toBe('TAB_EPOCH_CURRENT')
    vi.stubEnv('CHAIN_EPOCH', 'testnet-next')
    expect(
      await t.mutation(internal.tabs.voidResetEpoch, { chainEpoch: EPOCH })
    ).toEqual({ voided: 1, more: false })
    expect(await receiptStatuses(t)).toEqual(['VOID_RESET'])
    expect(await voucherRow(t)).toMatchObject({
      state: 'VOID_RESET',
      pendingNet: '0',
      unsettled: false,
    })
    expect((await earnings(t, s.authorId))?.pendingBaseUnits?.[TOKEN]).toBe('0')
  })

  it('credits Claimed to the recipient and leaves the treasury as an orphan', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const result = await ingest(
      t,
      ev.claimed(WRITER, BigInt(3_802_500)),
      ev.claimed(seedAddress(99), BigInt(97_500))
    )
    expect(result.byResult).toEqual({ done: 1, orphan: 1 })
    expect((await earnings(t, s.authorId))?.collectedBaseUnits?.[TOKEN]).toBe(
      '3802500'
    )
  })

  it('treats events of an unknown reader as orphans', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { open: false })
    const stranger = seedAddress(77)
    const result = await ingest(
      t,
      ev.deposited(stranger, XLM, XLM),
      ev.withdrawStarted(XLM, LEDGER + 1)
    )
    expect(result.byResult).toEqual({ orphan: 2 })
  })
})

describe('settler inputs', () => {
  it('lists unsettled vouchers with the fields Tab.settle needs', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    useVectorClientRefs()
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25, highlight: HIGHLIGHT })
    await tip(t, s, { cents: 4 })
    const { candidates: due } = await t.query(
      internal.tabSettlement.selectCandidates,
      { ledger: LEDGER, now: Date.now() }
    )
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({
      chainEpoch: EPOCH,
      unsettledAmount: '3900000',
      paidOnChain: '0',
      accountStatus: 'OPEN',
      settleBy: VALID_UNTIL + SETTLE_GRACE_LEDGERS,
      voucher: {
        reader: READER,
        writer: WRITER,
        keyId: 0,
        publicKey: SESSION_PUBLIC,
        cumulative: shared.vouchers[0]!.cumulative,
        receiptsRoot: shared.vouchers[0]!.receipts_root,
        signature: shared.vouchers[0]!.signature,
        acceptor: ACCEPTOR_PUBLIC,
        acceptanceSignature: shared.vouchers[0]!.acceptance_signature,
      },
    })
    const pending = await as(t, s.authorId).query(api.tabs.getWriterPending, {})
    expect(pending?.totals[TOKEN]).toEqual({
      earned: '0',
      pending: netOf(BigInt(3_900_000)).toString(),
    })
  })

  it('refuses acceptance when the Tab does not list the acceptor key', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    await t.run(async (ctx) => {
      const c = await ctx.db.query('chainConfig').first()
      await ctx.db.patch(c!._id, { tabAcceptorKeys: ['ab'.repeat(32)] })
    })
    expect(await errorCode(submit(t, s, p))).toBe('TAB_ACCEPTOR_MISMATCH')
    await t.run(async (ctx) => {
      const c = await ctx.db.query('chainConfig').first()
      await ctx.db.patch(c!._id, { tabAcceptorKeys: undefined })
    })
    expect(await errorCode(submit(t, s, p))).toBe('TAB_ACCEPTOR_MISMATCH')
    await t.run(async (ctx) => {
      const c = await ctx.db.query('chainConfig').first()
      await ctx.db.patch(c!._id, {
        tabAcceptorKeys: ['ab'.repeat(32), ACCEPTOR_PUBLIC],
      })
    })
    expect((await submit(t, s, p)).status).toBe('ACCEPTED')
    expect((await account(t)).outstanding).toBe('1000000')
  })

  it('refuses acceptance when settlement is disabled or the acceptor key is missing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    vi.stubEnv('SETTLEMENT_ENABLED', 'false')
    expect(await errorCode(submit(t, s, p))).toBe('TAB_ACCEPTOR_UNAVAILABLE')
    vi.stubEnv('SETTLEMENT_ENABLED', 'true')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', '')
    expect(await errorCode(submit(t, s, p))).toBe('TAB_ACCEPTOR_UNAVAILABLE')
    vi.stubEnv('STELLAR_NETWORK', 'PUBLIC')
    expect(await errorCode(submit(t, s, p))).not.toBe('no error')
  })
})

describe('signature bytes and key state at acceptance', () => {
  /** The session signature over the prepared voucher with one field changed. */
  function signVariant(
    p: Prepared,
    change: Partial<Parameters<typeof voucherPayloadBytes>[0]>,
    edit: (bytes: Uint8Array) => Uint8Array = (b) => b
  ) {
    const leaves = [...p.leafHashes, receiptLeafHex(p.receipt)]
    const payload = voucherPayloadBytes({
      tab: p.tabContractId,
      networkId: networkIdOf(PASSPHRASE),
      reader: READER,
      writer: p.writer,
      keyId: p.keyId,
      publicKey: hexToBytes(SESSION_PUBLIC),
      cumulative: BigInt(p.receipt.cumulativeAfter),
      receiptsRoot: hexToBytes(receiptsRootHex(leaves)),
      ...change,
    })
    return bytesToHex(signEd25519(SESSION_SEED, edit(payload)))
  }

  it('refuses signatures over any other network, contract, reader, writer or byte length', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    const variants: Record<string, string> = {
      network: signVariant(p, {
        networkId: networkIdOf(
          'Public Global Stellar Network ; September 2015'
        ),
      }),
      contract: signVariant(p, { tab: TOKEN }),
      reader: signVariant(p, { reader: OTHER_WRITER }),
      writer: signVariant(p, { writer: OTHER_WRITER }),
      key: signVariant(p, { keyId: 1 }),
      truncated: signVariant(p, {}, (b) => b.slice(0, -1)),
      extended: signVariant(p, {}, (b) => {
        const out = new Uint8Array(b.length + 1)
        out.set(b)
        return out
      }),
      short: sign(p).slice(0, 126),
      long: `${sign(p)}00`,
    }
    for (const [name, signature] of Object.entries(variants)) {
      expect([name, await errorCode(submit(t, s, p, { signature }))]).toEqual([
        name,
        'TAB_INVALID_SIGNATURE',
      ])
    }
    expect((await account(t)).outstanding).toBe('0')
    // The exact bytes are accepted.
    await submit(t, s, p)
    expect(await receiptStatuses(t)).toEqual(['ACCEPTED'])
  })

  it('verifies strictly, as the contract host does: no small-order key, no non-canonical S', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // A reader registers the identity point as a session key. A permissive
    // verifier accepts R = identity, S = 0 for every message under it; the host
    // refuses it, so such a voucher could never settle.
    const identity = `01${'00'.repeat(31)}`
    await ingest(
      t,
      tabEvent(
        'key_registered',
        [READER],
        [
          ['key_id', u32(1)],
          ['public_key', bytes(identity)],
          ['valid_until', u32(VALID_UNTIL)],
          ['spend_limit', i128(BigInt(50) * XLM)],
        ]
      )
    )
    const weak = await prepare(t, s, { keyId: 1 })
    expect(
      await errorCode(submit(t, s, weak, { signature: `01${'00'.repeat(63)}` }))
    ).toBe('TAB_INVALID_SIGNATURE')

    // S + L of a valid signature satisfies the same equation.
    const p = await prepare(t, s)
    const good = hexToBytes(sign(p))
    const L =
      (BigInt(1) << BigInt(252)) +
      BigInt('27742317777372353535851937790883648493')
    let scalar = BigInt(0)
    for (let i = 31; i >= 0; i--)
      scalar = (scalar << BigInt(8)) | BigInt(good[32 + i]!)
    const bumped = scalar + L
    const malleated = new Uint8Array(good)
    for (let i = 0; i < 32; i++)
      malleated[32 + i] = Number((bumped >> BigInt(8 * i)) & BigInt(255))
    expect(
      await errorCode(submit(t, s, p, { signature: bytesToHex(malleated) }))
    ).toBe('TAB_INVALID_SIGNATURE')
    expect((await account(t)).outstanding).toBe('0')
  })

  it('refuses a key the app declared but the indexer has not seen', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('tabAccounts').first())!
      await ctx.db.patch(row._id, {
        pendingKeys: [
          { publicKey: SESSION_PUBLIC, extractable: false, declaredAt: T0 },
        ],
      })
    })
    expect(await errorCode(prepare(t, s, { keyId: 1 }))).toBe('TAB_KEY_UNKNOWN')
  })

  it('refuses tips when the configured Tab contract is not the account contract', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s)
    // The Tab contract changes without a new chain epoch.
    vi.stubEnv('TAB_CONTRACT_ID', TOKEN)
    expect(await errorCode(prepare(t, s))).toBe('TAB_CONTRACT_MISMATCH')
    expect(await errorCode(submit(t, s, p))).toBe('TAB_CONTRACT_MISMATCH')
    expect((await account(t)).outstanding).toBe('0')
  })
})

describe('tab screens read models (tabActivity)', () => {
  it('lists the reader’s tab tips newest first with status and settlement health', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(await t.query(api.tabActivity.getMyTabTips, {})).toBeNull()
    await tip(t, s, { cents: 10 })
    vi.advanceTimersByTime(1_000)
    await tip(t, s, { cents: 25, highlight: HIGHLIGHT })
    const reader = as(t, s.readerId)
    let view = await reader.query(api.tabActivity.getMyTabTips, {})
    expect(view?.settlementEnabled).toBe(true)
    expect(view?.tips.map((r) => [r.seq, r.status, r.highlight])).toEqual([
      [2, 'ACCEPTED', true],
      [1, 'ACCEPTED', false],
    ])
    expect(view?.tips[1]).toMatchObject({
      amount: '1000000',
      writer: WRITER,
      articleTitle: 'on-writing-well',
      articleSlug: 'on-writing-well',
      authorUsername: 'writer',
      settledTxHash: null,
    })
    expect(view?.oldestUnsettledAt).toBe(view?.tips[1]?.acceptedAt)
    expect(view?.settleWindowEndsSoon).toBe(false)

    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(3_500_000),
        gross: BigInt(3_500_000),
      })
    )
    view = await reader.query(api.tabActivity.getMyTabTips, { limit: 1 })
    expect(view?.tips).toHaveLength(1)
    expect(view?.tips[0]?.status).toBe('SETTLED')
    // The settling transaction, from the pair's TabSettled event.
    expect(view?.tips[0]?.settledTxHash).toBe('ab'.repeat(32))
    expect(view?.oldestUnsettledAt).toBeNull()
    // Another user sees no tab.
    expect(
      await as(t, s.authorId).query(api.tabActivity.getMyTabTips, {})
    ).toBeNull()
  })

  it('reports settlement off and a settle window that ends within 2 days', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    vi.stubEnv('SETTLEMENT_ENABLED', 'false')
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS - DAY_LEDGERS)
    const view = await as(t, s.readerId).query(api.tabActivity.getMyTabTips, {})
    expect(view?.settlementEnabled).toBe(false)
    expect(view?.settleWindowEndsSoon).toBe(true)
  })

  it('sums the writer’s settled gross, fee, net, pending and collected', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await tip(t, s, { cents: 4 })
    const paid = BigInt(1_500_000)
    const accepted = BigInt(3_900_000)
    await ingest(
      t,
      ev.tabSettled({
        cumulative: accepted,
        paidAfter: paid,
        gross: paid,
      })
    )
    await ingest(t, ev.claimed(WRITER, netOf(paid)))
    const writer = await as(t, s.authorId).query(
      api.tabActivity.getMyTabEarnings,
      {}
    )
    expect(writer).toMatchObject({
      writerAddress: WRITER,
      tabContractId: TAB,
      tokenContractId: TOKEN,
      pairs: 1,
      settledGross: paid.toString(),
      fee: (paid - netOf(paid)).toString(),
      earnedNet: netOf(paid).toString(),
      pendingNet: (netOf(accepted) - netOf(paid)).toString(),
      collected: netOf(paid).toString(),
      unpaidPairs: 0,
      settlementEnabled: true,
    })
    // Receipt 1 settled, so the oldest unsettled receipt is a later one.
    expect(writer?.oldestUnsettledAt).toBeGreaterThan(T0)
    // 2.5% of 1.5 M, rounded down (I-31).
    expect(writer?.fee).toBe('37500')
    expect(await t.query(api.tabActivity.getMyTabEarnings, {})).toBeNull()
  })

  it('lists the newest tip after 1000 older receipts to writers that sort first', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await t.run(async (ctx) => {
      const real = (await ctx.db.query('tabReceipts').first())!
      const { _id, _creationTime, ...rest } = real
      for (let i = 0; i < 1000; i++) {
        await ctx.db.insert('tabReceipts', {
          ...rest,
          writerAddress: 'GA' + String(i % 4).repeat(54),
          seq: Math.floor(i / 4) + 1,
          clientRef: `old-${i}`,
          acceptedAt: real.acceptedAt - 1_000_000 - i,
        })
      }
    })
    const view = await as(t, s.readerId).query(api.tabActivity.getMyTabTips, {
      limit: 3,
    })
    expect(view?.tips.map((r) => [r.writer, r.seq])).toEqual([
      [WRITER, 1],
      ['GA' + '0'.repeat(54), 1],
      ['GA' + '1'.repeat(54), 1],
    ])
  }, 60_000)

  it('links an earlier receipt to the settlement that paid it, not a later one', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    const first = BigInt(1_000_000)
    await ingest(t, {
      ...ev.tabSettled(
        { cumulative: first, paidAfter: first, gross: first },
        { ledger: LEDGER + 1, id: 'settle-first' }
      ),
      txHash: '11'.repeat(32),
    })
    vi.advanceTimersByTime(1_000)
    await tip(t, s, { cents: 25 })
    const second = BigInt(3_500_000)
    await ingest(t, {
      ...ev.tabSettled(
        { cumulative: second, paidAfter: second, gross: second - first },
        { ledger: LEDGER + 2, id: 'settle-second' }
      ),
      txHash: '22'.repeat(32),
    })
    const view = await as(t, s.readerId).query(api.tabActivity.getMyTabTips, {})
    const bySeq = Object.fromEntries(
      (view?.tips ?? []).map((r) => [r.seq, [r.status, r.settledTxHash]])
    )
    expect(bySeq[2]).toEqual(['SETTLED', '22'.repeat(32)])
    expect(bySeq[1]).toEqual(['SETTLED', '11'.repeat(32)])
  })

  it('shows no tab to another user who verified the same address', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    const otherId = await t.run((ctx) =>
      ctx.db.insert('users', {
        username: 'second-reader',
        email: 'second@example.test',
        stellarAddress: READER,
        stellarAddressVerifiedAt: Date.now(),
        stellarAddressVerifiedNetwork: PASSPHRASE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
    expect(
      await as(t, s.readerId).query(api.tabActivity.getMyTabTips, {})
    ).not.toBeNull()
    expect(
      await as(t, otherId).query(api.tabActivity.getMyTabTips, {})
    ).toBeNull()
  })

  it('counts only UNPAID pairs as unpaid and blocked pairs as shortfall', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    const earnings = () =>
      as(t, s.authorId).query(api.tabActivity.getMyTabEarnings, {})
    const setPair = (patch: Partial<Doc<'tabVouchers'>>) =>
      t.run(async (ctx) => {
        const pair = (await ctx.db.query('tabVouchers').first())!
        await ctx.db.patch(pair._id, patch)
      })
    expect(await earnings()).toMatchObject({
      unpaidPairs: 0,
      shortfallPairs: 0,
      shortfallNet: '0',
    })
    await setPair({ settleQueue: 'blocked' })
    const blocked = await earnings()
    expect(blocked?.shortfallPairs).toBe(1)
    expect(blocked?.shortfallNet).toBe(blocked?.pendingNet)
    expect(blocked?.shortfallNet).not.toBe('0')
    for (const state of ['REJECTED', 'VOID_RESET'] as const) {
      await setPair({ state })
      expect(await earnings()).toMatchObject({
        unpaidPairs: 0,
        shortfallPairs: 0,
      })
    }
    await setPair({ state: 'UNPAID' })
    expect(await earnings()).toMatchObject({
      unpaidPairs: 1,
      shortfallPairs: 0,
    })
  })

  it('reports whether settlement is on without a tab or a sign-in', async () => {
    const t = convexTest(schema, modules)
    expect(await t.query(api.tabActivity.getTabSettlement, {})).toEqual({
      settlementEnabled: true,
    })
    vi.stubEnv('SETTLEMENT_ENABLED', '')
    expect(await t.query(api.tabActivity.getTabSettlement, {})).toEqual({
      settlementEnabled: false,
    })
  })
})
