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
import { checkTabTipAmount, tabTipLimitsAt } from '../../lib/tab-ui/tip-limits'
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

describe('tip limits in getMyTab (#546)', () => {
  it('gives the raw limits prepare checks, the same at any time', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, BigInt(100) * XLM, BigInt(100) * XLM))
    await ingest(t, ev.keyRegistered(READER, 0, VALID_UNTIL, BigInt(50) * XLM))
    const reader = as(t, s.readerId)
    const limits = (await reader.query(api.tabs.getMyTab, {}))!.tipLimits!
    expect(limits).toEqual({
      tipMax: '50000000',
      dailyLimit: '200000000',
      acceptedToday: '0',
      acceptedDay: '2026-12-02',
      minTip: '100000',
      priceUsd: 1,
      priceFetchedAt: T0,
      priceMaxAgeMs: 30 * 60 * 1000,
      // $1 per XLM: 500 cents is 5 XLM, the default maximum.
      tipMaxCents: 500,
    })
    // The client's check and prepare agree at the maximum.
    const check = (cents: number, now: number, l = limits) =>
      checkTabTipAmount({ cents, limits: l, free: '1000000000', now })
    expect(check(500, T0)).toMatchObject({ ok: true })
    expect(check(501, T0)).toMatchObject({ reason: 'above-max' })
    expect(await errorCode(prepare(t, s, { cents: 501 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
    await tip(t, s, { cents: 500 })
    const after = (await reader.query(api.tabs.getMyTab, {}))!.tipLimits!
    expect(after).toMatchObject({
      acceptedToday: '50000000',
      acceptedDay: '2026-12-02',
    })
    // Nothing in the query depends on the time: a subscription left open
    // across midnight keeps these values, and the client applies the day.
    vi.setSystemTime(T0 + 24 * 3600 * 1000)
    expect((await reader.query(api.tabs.getMyTab, {}))!.tipLimits).toEqual(
      after
    )
    const nextDay = T0 + 24 * 3600 * 1000
    expect(
      tabTipLimitsAt(
        { ...after, priceFetchedAt: nextDay },
        nextDay
      ).dailyLeft.toString()
    ).toBe('200000000')
  })

  it('gives the price with its age, so the client and prepare agree it is stale', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM))
    await ingest(t, ev.keyRegistered(READER, 0, VALID_UNTIL, BigInt(50) * XLM))
    const stale = T0 + 30 * 60 * 1000 + 1
    vi.setSystemTime(stale)
    const limits = (await as(t, s.readerId).query(api.tabs.getMyTab, {}))!
      .tipLimits!
    expect(limits).toMatchObject({ priceUsd: 1, priceFetchedAt: T0 })
    expect(tabTipLimitsAt(limits, stale)).toMatchObject({
      priceUsd: null,
      tipMaxCents: null,
    })
    expect(await errorCode(prepare(t, s, { cents: 10 }))).toBe(
      'TAB_PRICE_UNAVAILABLE'
    )
    // One millisecond earlier both still use it.
    expect(tabTipLimitsAt(limits, stale - 1).priceUsd).toBe(1)
  })

  it('follows TAB_TIP_MAX and a price that does not divide evenly', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    process.env.TAB_TIP_MAX = '25000000'
    try {
      await ingest(
        t,
        ev.deposited(READER, BigInt(100) * XLM, BigInt(100) * XLM)
      )
      await ingest(
        t,
        ev.keyRegistered(READER, 0, VALID_UNTIL, BigInt(50) * XLM)
      )
      await t.run(async (ctx) => {
        const p = await ctx.db.query('xlmPriceCache').first()
        await ctx.db.patch(p!._id, { priceUsd: 0.1337 })
      })
      const limits = (await as(t, s.readerId).query(api.tabs.getMyTab, {}))!
        .tipLimits!
      expect(limits.tipMax).toBe('25000000')
      // 33 cents is 2.4682124 XLM; 34 cents would be 2.5430067 XLM.
      expect(limits.tipMaxCents).toBe(33)
      await tip(t, s, { cents: 33 })
      expect(await errorCode(prepare(t, s, { cents: 34 }))).toBe(
        'TAB_ABOVE_TIP_MAX'
      )
    } finally {
      delete process.env.TAB_TIP_MAX
    }
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
    // Prepared, nothing indexed: the account exists but is not on chain yet
    // (#547), so the screens do not show an open tab with zero balances.
    expect(await as(t, s.readerId).query(api.tabs.getMyTab, {})).toMatchObject({
      status: 'OPEN',
      confirmedBalance: '0',
      onChain: false,
    })
    await ingest(
      t,
      ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM),
      ev.keyRegistered(READER, 0)
    )
    const tab = await as(t, s.readerId).query(api.tabs.getMyTab, {})
    expect(tab).toMatchObject({
      onChain: true,
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

// ---------------------------------------------------------------------------
// Spendable balance across the settler's record and the indexed events.
//
// The settler records a confirmed settlement from its own transaction result;
// the indexer applies the same `TabSettled` events later. Whichever arrives
// first, and however often, the reader's spendable balance must never exceed
// deposits minus accepted tips, and must equal it once both have arrived.

describe('spendable balance across settler records and indexed events', () => {
  /** 1 cent at the seeded $1 per XLM. */
  const CENT = BigInt(100_000)

  async function myTab(t: T, s: Seeded) {
    const tab = await as(t, s.readerId).query(api.tabs.getMyTab, {})
    if (!tab) throw new Error('no tab')
    return tab
  }

  async function spendable(t: T, s: Seeded): Promise<bigint> {
    return BigInt((await myTab(t, s)).available)
  }

  async function pairs(t: T) {
    return t.run(async (ctx) => ctx.db.query('tabVouchers').collect())
  }

  /** `Tab.settle` as the settler starts it: the record, then the result. */
  async function beginSettlement(t: T, voucherIds?: Id<'tabVouchers'>[]) {
    const ready = (await pairs(t)).filter(
      (v) =>
        v.settleQueue === 'ready' &&
        (voucherIds === undefined || voucherIds.includes(v._id))
    )
    const settlementId = await t.mutation(internal.tabSettlement.begin, {
      voucherIds: ready.map((v) => v._id),
      cumulatives: ready.map((v) => v.cumulative),
      submitter: READER,
      maxTime: Math.floor(Date.now() / 1000) + 300,
    })
    return { settlementId, vouchers: ready }
  }

  type Outcome =
    | {
        kind: 'settled'
        writer: string
        cumulative: bigint
        paidAfter: bigint
        gross: bigint
      }
    | { kind: 'skipped'; writer: string; cumulative: bigint; reason: number }

  async function settlerRecord(
    t: T,
    settlementId: Id<'tabSettlements'>,
    outcomes: Outcome[],
    ledger = LEDGER + 1
  ) {
    await t.mutation(internal.tabSettlement.finish, {
      settlementId,
      result: {
        status: 'CONFIRMED',
        txHash: 'cd'.repeat(32),
        ledger,
        outcomes: outcomes.map((o) =>
          o.kind === 'settled'
            ? {
                kind: 'settled' as const,
                reader: READER,
                writer: o.writer,
                keyId: 0,
                cumulative: o.cumulative.toString(),
                paidAfter: o.paidAfter.toString(),
                gross: o.gross.toString(),
                fee: fee(o.gross).toString(),
              }
            : {
                kind: 'skipped' as const,
                reader: READER,
                writer: o.writer,
                keyId: 0,
                cumulative: o.cumulative.toString(),
                reason: o.reason,
              }
        ),
      },
    })
  }

  const fee = (x: bigint) => (x * BigInt(250)) / BigInt(10_000)

  function settledEvent(
    o: Extract<Outcome, { kind: 'settled' }>,
    options: { ledger?: number } = {}
  ) {
    return ev.tabSettled(
      {
        writer: o.writer,
        cumulative: o.cumulative,
        paidAfter: o.paidAfter,
        gross: o.gross,
        fee: fee(o.gross),
      },
      options
    )
  }

  /** The indexer has applied every event up to `ledger`. */
  async function caughtUp(t: T, ledger: number) {
    await t.run(async (ctx) => {
      const cursor = (await ctx.db.query('chainCursor').first())!
      if (cursor.lastLedger < ledger) {
        await ctx.db.patch(cursor._id, { lastLedger: ledger })
      }
    })
  }

  /**
   * The operator reconciliation with a chain read: the contract's balance
   * and `paid` per writer (key 0) at `ledger`. The indexer is marked as
   * caught up to `ledger` unless `behind` is set.
   */
  async function reconcileAt(
    t: T,
    read: { ledger: number; balance: bigint; paid: Map<string, bigint> },
    o: { apply?: boolean; writer?: string; behind?: boolean } = {}
  ) {
    if (!o.behind) await caughtUp(t, read.ledger)
    const snap = await t.query(internal.chain.tabReconcile.snapshot, {
      reader: READER,
      ...(o.writer ? { keyId: 0, writer: o.writer } : {}),
    })
    if (!snap) throw new Error('no snapshot')
    return t.mutation(internal.chain.tabReconcile.reconcile, {
      tabAccountId: snap.tabAccountId,
      digest: snap.digest,
      pairs: snap.pairs,
      chain: {
        ledger: read.ledger,
        balance: read.balance.toString(),
        paid: snap.pairs.map((p) => ({
          ...p,
          paid: (read.paid.get(p.writer) ?? BigInt(0)).toString(),
        })),
      },
      apply: o.apply ?? true,
    })
  }

  async function releases(t: T) {
    return t.run(async (ctx) => ctx.db.query('tabReserveReleases').collect())
  }

  async function accepts(
    t: T,
    s: Seeded,
    cents: number,
    articleId?: Id<'articles'>
  ) {
    try {
      await tip(t, s, { cents, ...(articleId ? { articleId } : {}) })
      return true
    } catch (error) {
      const code = await errorCode(Promise.reject(error))
      if (code === 'TAB_OVER_BALANCE') return false
      throw error
    }
  }

  /** Opens a tab with `deposit` and accepts `cents` to WRITER. */
  async function opened(deposit: bigint, cents: number[]) {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await ingest(t, ev.deposited(READER, deposit, deposit))
    await ingest(t, ev.keyRegistered(READER, 0))
    for (const c of cents) await tip(t, s, { cents: c })
    return { t, s }
  }

  it('settler record first: the free balance does not rise before the event', async () => {
    // Deposit 0.15 XLM, accept 0.10 XLM: 0.05 XLM is free.
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)

    const { settlementId } = await beginSettlement(t)
    const paid: Outcome = {
      kind: 'settled',
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    // Chain: balance 0.05 XLM, nothing owed. Still 0.05 XLM free.
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await accepts(t, s, 10)).toBe(false)
    expect(await accepts(t, s, 5)).toBe(true)
    expect(await spendable(t, s)).toBe(BigInt(0))

    await ingest(t, settledEvent(paid as Extract<Outcome, { kind: 'settled' }>))
    expect(await spendable(t, s)).toBe(BigInt(0))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      outstanding: (BigInt(5) * CENT).toString(),
    })
  })

  it('event first, then the settler record, then the event again', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    const event = settledEvent(paid)
    await ingest(t, event)
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await settlerRecord(t, settlementId, [paid])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    const replay = await ingest(t, event)
    expect(replay.duplicates).toBe(1)
    // The same event under a new id (a handler run twice) changes nothing.
    await t.run(async (ctx) => {
      const row = await ctx.db.query('chainEvents').order('desc').first()
      await ctx.db.patch(row!._id, { handled: 'pending' })
    })
    await t.mutation(internal.chain.indexer.redispatch, {})
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      outstanding: '0',
    })
  })

  it('a settlement that fails after its record changes nothing', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await t.mutation(internal.tabSettlement.finish, {
      settlementId,
      result: { status: 'FAILED', reason: 'tx failed' },
    })
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await accepts(t, s, 10)).toBe(false)
  })

  it('a partial settlement with a skipped voucher and a shortfall', async () => {
    // 0.30 XLM deposited; 0.10 to WRITER, 0.15 to OTHER_WRITER: 0.05 free.
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    await tip(t, s, { cents: 15, articleId: s.otherArticleId })
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    const { settlementId } = await beginSettlement(t)
    // WRITER is paid 0.06 of 0.10 (shortfall). OTHER_WRITER is skipped as
    // STALE: its writer's `settle_own` paid it first.
    const short = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(6) * CENT,
      gross: BigInt(6) * CENT,
    }
    await settlerRecord(t, settlementId, [
      short,
      {
        kind: 'skipped',
        writer: OTHER_WRITER,
        cumulative: BigInt(15) * CENT,
        reason: 3,
      },
    ])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await accepts(t, s, 6)).toBe(false)
    await ingest(t, settledEvent(short))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(
      t,
      settledEvent({
        kind: 'settled',
        writer: OTHER_WRITER,
        cumulative: BigInt(15) * CENT,
        paidAfter: BigInt(15) * CENT,
        gross: BigInt(15) * CENT,
      })
    )
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(9) * CENT).toString(),
      outstanding: (BigInt(4) * CENT).toString(),
      available: (BigInt(5) * CENT).toString(),
    })
  })

  it('a deposit indexed inside the window', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    // Chain order: top-up of 0.20 XLM, then the settlement.
    const topUp = ev.deposited(READER, BigInt(20) * CENT, BigInt(35) * CENT)
    const event = settledEvent(paid)
    await settlerRecord(t, settlementId, [paid])
    await ingest(t, topUp)
    // Chain: 0.25 XLM, nothing owed. Deposits 0.35 minus accepted 0.10.
    expect(await spendable(t, s)).toBe(BigInt(25) * CENT)
    await ingest(t, event)
    expect(await spendable(t, s)).toBe(BigInt(25) * CENT)
  })

  it('a deposit indexed after the settlement it follows on chain', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    // Chain order: the settlement, then a top-up of 0.20 XLM (0.25 after).
    const event = settledEvent(paid)
    const topUp = ev.deposited(READER, BigInt(20) * CENT, BigInt(25) * CENT)
    await settlerRecord(t, settlementId, [paid])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(t, event, topUp)
    expect(await spendable(t, s)).toBe(BigInt(25) * CENT)
  })

  it('a tab in CLOSING', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    await ingest(
      t,
      ev.withdrawStarted(BigInt(15) * CENT, LEDGER + 3 * DAY_LEDGERS)
    )
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(t, settledEvent(paid))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    // Cancelled withdrawal: the absolute balance already includes the debit.
    await ingest(t, ev.withdrawCancelled(BigInt(5) * CENT))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await accepts(t, s, 6)).toBe(false)
  })

  it('a key reset inside the window', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    await ingest(t, ev.keyRevoked(READER, 0, LEDGER + 10))
    await ingest(t, ev.keyRegistered(READER, 1))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await errorCode(tip(t, s, { cents: 10, keyId: 1 }))).toBe(
      'TAB_OVER_BALANCE'
    )
    await ingest(t, settledEvent(paid))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
  })

  it('a STALE skip after the writer settled the pair', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    // The writer's `settle_own` paid the pair before the settler's batch.
    const own = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [
      {
        kind: 'skipped',
        writer: WRITER,
        cumulative: BigInt(10) * CENT,
        reason: 3,
      },
    ])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(t, settledEvent(own))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
  })

  it('a backfill after a long indexer gap, then a replay and a re-dispatch', async () => {
    // Chain: deposit 0.30; three settlements and a top-up while the indexer
    // is down; the settler records each result at once.
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    const truth = {
      deposits: BigInt(30) * CENT,
      /** Deposits the app has indexed: a top-up counts once it is read. */
      indexed: BigInt(30) * CENT,
      accepted: BigInt(10) * CENT,
    }
    const free = () => truth.deposits - truth.accepted
    const shown = () => truth.indexed - truth.accepted
    const events: RawRpcEvent[] = []
    let paid = BigInt(0)
    const settleAll = async () => {
      const { settlementId, vouchers } = await beginSettlement(t)
      const cumulative = BigInt(vouchers[0]!.cumulative)
      const o = {
        kind: 'settled' as const,
        writer: WRITER,
        cumulative,
        paidAfter: cumulative,
        gross: cumulative - paid,
      }
      paid = cumulative
      events.push(settledEvent(o))
      await settlerRecord(t, settlementId, [o])
      expect(await spendable(t, s)).toBe(shown())
    }
    await settleAll()
    expect(await accepts(t, s, 8)).toBe(true)
    truth.accepted += BigInt(8) * CENT
    await settleAll()
    events.push(ev.deposited(READER, BigInt(5) * CENT, BigInt(17) * CENT))
    truth.deposits += BigInt(5) * CENT
    expect(await accepts(t, s, 4)).toBe(true)
    truth.accepted += BigInt(4) * CENT
    await settleAll()
    expect(await spendable(t, s)).toBe(shown())
    expect(shown() < free()).toBe(true)
    expect(await accepts(t, s, 9)).toBe(false)

    // The indexer catches up in one batch, then sees it all again.
    await ingest(t, ...events)
    truth.indexed = truth.deposits
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(13) * CENT).toString(),
      outstanding: '0',
      available: free().toString(),
    })
    expect((await ingest(t, ...events)).duplicates).toBe(events.length)
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        await ctx.db.patch(row._id, { handled: 'pending' })
      }
    })
    await t.mutation(internal.chain.indexer.redispatch, {})
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(13) * CENT).toString(),
      outstanding: '0',
      available: free().toString(),
    })
    expect((await account(t)).settledUnindexed).toBe('0')
  })

  it('a settler record that no indexed event confirms keeps the reserve', async () => {
    // The chain never shows the recorded settlement: the balance is not
    // debited and the tip is still owed on chain.
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [
      {
        kind: 'settled',
        writer: WRITER,
        cumulative: BigInt(10) * CENT,
        paidAfter: BigInt(10) * CENT,
        gross: BigInt(10) * CENT,
      },
    ])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    // Later events that do not carry it change nothing about the reserve.
    await ingest(t, ev.deposited(READER, BigInt(5) * CENT, BigInt(20) * CENT))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(20) * CENT).toString(),
      outstanding: (BigInt(10) * CENT).toString(),
      available: (BigInt(10) * CENT).toString(),
    })
    expect((await account(t)).settledUnindexed).toBe(
      (BigInt(10) * CENT).toString()
    )
  })

  it('flags a negative ledger amount instead of hiding it', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    // Stored figures that disagree: the pair owes 0.10, the account 0.
    await t.run(async (ctx) => {
      const row = await ctx.db.query('tabAccounts').first()
      await ctx.db.patch(row!._id, { outstanding: '0' })
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    const flagged = errors.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, string>)
      .filter((e) => e.code === 'CHAIN_TAB_LEDGER_NEGATIVE')
    expect(flagged).toEqual([
      expect.objectContaining({
        field: 'account.outstanding',
        value: (-BigInt(10) * CENT).toString(),
      }),
    ])
    // Stored as zero: the reserve is not lowered by the bad figure.
    expect(await account(t)).toMatchObject({
      outstanding: '0',
      settledUnindexed: (BigInt(10) * CENT).toString(),
    })
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
  })

  /** Deterministic PRNG (mulberry32), so a failing seed can be replayed. */
  function prng(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let x = Math.imul(a ^ (a >>> 15), 1 | a)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296
    }
  }

  it('holds over random interleavings of tips, deposits, settlements, records and events', async () => {
    const SEEDS = 12
    const STEPS = 36
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = prng(seed)
      const pick = (n: number) => Math.floor(rand() * n)
      const initial = BigInt(20) * CENT
      const { t, s } = await opened(initial, [])
      const writers = [
        { address: WRITER, articleId: s.articleId },
        { address: OTHER_WRITER, articleId: s.otherArticleId },
      ]
      // The fake Tab: the reader's balance and each pair's paid amount.
      let chainBalance = initial
      let deposits = initial
      let accepted = BigInt(0)
      const chainPaid = new Map<string, bigint>()
      const queue: RawRpcEvent[] = []
      const indexed: RawRpcEvent[] = []
      type Recorded = { id: Id<'tabSettlements'>; outcomes: Outcome[] }
      // Set inside `settle`: declared without an initial narrowing to null.
      let record = null as Recorded | null
      const trace: string[] = []

      const check = async (step: string) => {
        trace.push(step)
        const free = await spendable(t, s)
        if (free > deposits - accepted) {
          throw new Error(
            `seed ${seed}: spendable ${free} > deposits ${deposits} − accepted ${accepted}\n${trace.join('\n')}`
          )
        }
      }

      const settle = async () => {
        if (record) return 'settle: record pending'
        const ready = (await pairs(t)).filter((v) => v.settleQueue === 'ready')
        if (!ready.length) return 'settle: nothing ready'
        const { settlementId, vouchers } = await beginSettlement(t)
        const outcomes: Outcome[] = []
        for (const v of vouchers) {
          const cumulative = BigInt(v.cumulative)
          const paid = chainPaid.get(v.writerAddress) ?? BigInt(0)
          const delta = cumulative - paid
          const gross = delta < chainBalance ? delta : chainBalance
          if (delta <= BigInt(0) || gross <= BigInt(0)) {
            const reason = delta <= BigInt(0) ? 3 : 4
            outcomes.push({
              kind: 'skipped',
              writer: v.writerAddress,
              cumulative,
              reason,
            })
            queue.push(
              tabEvent(
                'voucher_skipped',
                [READER, v.writerAddress],
                [
                  ['key_id', u32(0)],
                  ['cumulative', i128(cumulative)],
                  ['reason', u32(reason)],
                ]
              )
            )
            continue
          }
          chainBalance -= gross
          chainPaid.set(v.writerAddress, paid + gross)
          const o = {
            kind: 'settled' as const,
            writer: v.writerAddress,
            cumulative,
            paidAfter: paid + gross,
            gross,
          }
          outcomes.push(o)
          queue.push(settledEvent(o))
        }
        record = { id: settlementId, outcomes }
        return `settle: ${outcomes.map((o) => (o.kind === 'settled' ? `${o.writer.slice(0, 4)} +${o.gross}` : `${o.writer.slice(0, 4)} skip ${o.reason}`)).join(', ')}`
      }

      for (let i = 0; i < STEPS; i++) {
        const op = pick(7)
        if (op === 0 || op === 1) {
          const w = writers[pick(2)]!
          const cents = 1 + pick(8)
          const ok = await accepts(t, s, cents, w.articleId)
          if (ok) accepted += BigInt(cents) * CENT
          await check(`tip ${cents}c to ${w.address.slice(0, 4)}: ${ok}`)
        } else if (op === 2) {
          const amount = BigInt(1 + pick(10)) * CENT
          chainBalance += amount
          deposits += amount
          queue.push(ev.deposited(READER, amount, chainBalance))
          await check(`deposit ${amount} (chain only)`)
        } else if (op === 3) {
          await check(await settle())
        } else if (op === 4 && record) {
          await settlerRecord(t, record.id, record.outcomes)
          record = null
          await check('settler record')
        } else if (op === 5 && queue.length) {
          const batch = queue.splice(0, 1 + pick(3))
          await ingest(t, ...batch)
          indexed.push(...batch)
          await check(`index ${batch.length}`)
        } else if (op === 6 && indexed.length) {
          await ingest(t, indexed[pick(indexed.length)]!)
          await check('replay an indexed event')
        }
      }

      // Everything arrives: spendable is exactly deposits minus accepted.
      if (record) await settlerRecord(t, record.id, record.outcomes)
      await ingest(t, ...queue.splice(0))
      await check('drain')
      const tab = await myTab(t, s)
      expect(BigInt(tab.confirmedBalance), `seed ${seed}`).toBe(chainBalance)
      expect(BigInt(tab.available), `seed ${seed}`).toBe(deposits - accepted)
    }
  }, 120_000)

  // -------------------------------------------------------------------------
  // Review attacks (#565): orders, repetitions and delays the cases above do
  // not reach, checked against a model of the Tab contract.

  /** What the chain allows: balance minus everything accepted and unpaid. */
  type ChainModel = {
    balance: bigint
    paid: Map<string, bigint>
    accepted: Map<string, bigint>
  }
  const chainSpendable = (m: ChainModel) => {
    let owed = BigInt(0)
    for (const [w, cum] of m.accepted) {
      const d = cum - (m.paid.get(w) ?? BigInt(0))
      if (d > BigInt(0)) owed += d
    }
    return m.balance - owed
  }

  /** Free + Settling = Tab balance, and no flagged negative figure. */
  async function screenSums(t: T, s: Seeded) {
    const tab = await myTab(t, s)
    expect(BigInt(tab.available) + BigInt(tab.outstanding)).toBe(
      BigInt(tab.confirmedBalance)
    )
  }

  function negatives() {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    return () =>
      spy.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as Record<string, string>
          } catch {
            return {}
          }
        })
        .filter((e) => e.code === 'CHAIN_TAB_LEDGER_NEGATIVE')
  }

  it('review: a writer settle_own after the settler, events in reverse order', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    // Settler pays 0.06 (the reader's balance allowed only that at the time
    // in this story); the writer's settle_own pays the other 0.04.
    const { settlementId } = await beginSettlement(t)
    const first = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(6) * CENT,
      gross: BigInt(6) * CENT,
    }
    const own = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(4) * CENT,
    }
    const e1 = settledEvent(first)
    const e2 = settledEvent(own)
    const truth = BigInt(20) * CENT
    // The writer's event (later on chain) is indexed first.
    await ingest(t, e2)
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    await screenSums(t, s)
    await settlerRecord(t, settlementId, [first])
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    await screenSums(t, s)
    await ingest(t, e1)
    expect(await spendable(t, s)).toBe(truth)
    await ingest(t, e2, e1)
    expect(await spendable(t, s)).toBe(truth)
    expect(await account(t)).toMatchObject({
      confirmedBalance: truth.toString(),
      outstanding: '0',
      settledUnindexed: '0',
    })
    expect(flagged()).toEqual([])
  })

  it('review: an event range beyond the settler record, then the record', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    // The record says 0.06 was paid; the indexed events show 0.10 in two
    // settlements, the second outside this settler.
    await settlerRecord(t, settlementId, [
      {
        kind: 'settled',
        writer: WRITER,
        cumulative: BigInt(10) * CENT,
        paidAfter: BigInt(6) * CENT,
        gross: BigInt(6) * CENT,
      },
    ])
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10) * CENT,
        paidAfter: BigInt(10) * CENT,
        gross: BigInt(4) * CENT,
      })
    )
    // Chain: 0.30 − 0.06 − 0.04 = 0.20, nothing owed. The record's 0.06
    // stays reserved until its own event debits the balance.
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
    expect((await account(t)).settledUnindexed).toBe(
      (BigInt(6) * CENT).toString()
    )
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10) * CENT,
        paidAfter: BigInt(6) * CENT,
        gross: BigInt(6) * CENT,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
    expect((await account(t)).settledUnindexed).toBe('0')
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('review: two pairs of one reader in one settle, events split and replayed', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(40) * CENT, [10])
    await tip(t, s, { cents: 15, articleId: s.otherArticleId })
    const { settlementId } = await beginSettlement(t)
    const a = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    const b = {
      kind: 'settled' as const,
      writer: OTHER_WRITER,
      cumulative: BigInt(15) * CENT,
      paidAfter: BigInt(15) * CENT,
      gross: BigInt(15) * CENT,
    }
    const ea = settledEvent(a)
    const eb = settledEvent(b)
    const truth = BigInt(15) * CENT
    await ingest(t, eb)
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    await settlerRecord(t, settlementId, [a, b])
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    await settlerRecord(t, settlementId, [a, b])
    await ingest(t, eb, ea, ea)
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        await ctx.db.patch(row._id, { handled: 'pending' })
      }
    })
    await t.mutation(internal.chain.indexer.redispatch, {})
    expect(await spendable(t, s)).toBe(truth)
    expect(await account(t)).toMatchObject({
      confirmedBalance: truth.toString(),
      outstanding: '0',
      settledUnindexed: '0',
    })
    expect(flagged()).toEqual([])
  })

  it('review: the pair window ends between the record and the event', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1)
    await t.mutation(internal.tabs.sweepUnpaid, {})
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(t, settledEvent(paid))
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect((await account(t)).settledUnindexed).toBe('0')
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('review: an epoch void between the record and the event', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [paid])
    vi.stubEnv('CHAIN_EPOCH', 'testnet-next')
    await t.mutation(internal.tabs.voidResetEpoch, { chainEpoch: EPOCH })
    vi.stubEnv('CHAIN_EPOCH', EPOCH)
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(15) * CENT).toString(),
      outstanding: '0',
      settledUnindexed: (BigInt(10) * CENT).toString(),
    })
    await ingest(t, settledEvent(paid))
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      outstanding: '0',
      settledUnindexed: '0',
    })
    expect(flagged()).toEqual([])
    void s
  })

  it('review: a settlement, then a full withdrawal, inside the window', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    // Chain order: settlement, withdraw_start, withdraw (takes 0.05).
    const settled = settledEvent(paid)
    const started = ev.withdrawStarted(BigInt(5) * CENT, LEDGER + 10)
    const taken = ev.withdrawn(BigInt(5) * CENT)
    await settlerRecord(t, settlementId, [paid])
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    // The withdrawal is indexed before the settlement event.
    await ingest(t, started, taken)
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(0))
    await screenSums(t, s)
    await ingest(t, settled)
    expect(await account(t)).toMatchObject({
      confirmedBalance: '0',
      outstanding: '0',
      settledUnindexed: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(0))
    expect(flagged()).toEqual([])
  })

  it('review: a withdrawal, then a SHORTFALL skip: nothing is spendable', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    await ingest(
      t,
      ev.withdrawStarted(BigInt(15) * CENT, LEDGER + 10),
      ev.withdrawn(BigInt(15) * CENT)
    )
    // The account is CLOSED: its pairs are swept, or the settler meets an
    // empty balance. Either way spendable never rises above zero.
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(0))
    const ready = (await pairs(t)).filter((v) => v.settleQueue === 'ready')
    if (ready.length) {
      const { settlementId } = await beginSettlement(t)
      await settlerRecord(t, settlementId, [
        {
          kind: 'skipped',
          writer: WRITER,
          cumulative: BigInt(10) * CENT,
          reason: 4,
        },
      ])
      await ingest(t, ev.voucherSkipped(BigInt(10) * CENT, 4))
    }
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(0))
    expect(BigInt((await myTab(t, s)).confirmedBalance)).toBe(BigInt(0))
    expect(await errorCode(tip(t, s, { cents: 1 }))).not.toBe('')
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('review: rows written before the change meet new records and events', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(40) * CENT, [10])
    // The old code applied the settler record: paid raised, outstanding
    // lowered, no reserve and no indexed ranges.
    const { settlementId } = await beginSettlement(t)
    const first = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [first])
    await t.run(async (ctx) => {
      const a = await ctx.db.query('tabAccounts').first()
      await ctx.db.patch(a!._id, { settledUnindexed: undefined })
      for (const v of await ctx.db.query('tabVouchers').collect()) {
        await ctx.db.patch(v._id, { indexedPaid: undefined })
      }
    })
    // After the deploy: a new tip and a new settlement on the same pair,
    // then both events, the old one last.
    await tip(t, s, { cents: 5 })
    const next = await beginSettlement(t)
    const second = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(15) * CENT,
      paidAfter: BigInt(15) * CENT,
      gross: BigInt(5) * CENT,
    }
    await settlerRecord(t, next.settlementId, [second])
    // Chain: 0.40 − 0.15 = 0.25 free.
    const truth = BigInt(25) * CENT
    await ingest(t, settledEvent(second))
    await screenSums(t, s)
    await ingest(t, settledEvent(first))
    expect(await spendable(t, s)).toBe(truth)
    expect(await account(t)).toMatchObject({
      confirmedBalance: truth.toString(),
      settledUnindexed: '0',
    })
    expect(flagged()).toEqual([])
  })

  // -------------------------------------------------------------------------
  // #573: a settlement reserve whose `TabSettled` is never indexed.

  const paidOf = (writer: string, cents: number) => ({
    kind: 'settled' as const,
    writer,
    cumulative: BigInt(cents) * CENT,
    paidAfter: BigInt(cents) * CENT,
    gross: BigInt(cents) * CENT,
  })

  it('a lost TabSettled: an absolute balance from a later ledger releases the reserve once (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    const lost = settledEvent(paid, { ledger: LEDGER + 1 })
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect((await account(t)).settledUnindexedSince).toBeGreaterThanOrEqual(T0)
    // Chain: 0.05 after the settlement, then a 0.05 top-up: 0.10, all free.
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(10) * CENT).toString(),
      outstanding: '0',
      available: (BigInt(10) * CENT).toString(),
    })
    const after = await account(t)
    expect(after.settledUnindexed).toBe('0')
    expect(after.settledUnindexedSince).toBeUndefined()
    const rows = await releases(t)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'balance_event',
      ledger: LEDGER + 2,
      spendableBefore: '0',
      spendableAfter: (BigInt(10) * CENT).toString(),
      pairs: [
        { writerAddress: WRITER, released: (BigInt(10) * CENT).toString() },
      ],
    })
    // The event arrives after all, and again: no debit, no second release.
    await ingest(t, lost)
    await ingest(t, lost)
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(10) * CENT).toString(),
      available: (BigInt(10) * CENT).toString(),
    })
    expect(await releases(t)).toHaveLength(1)
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('an absolute balance from the settlement ledger itself releases nothing (#573)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    // Same ledger: the deposit may come before the settlement in it.
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 1,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(0))
    expect(await releases(t)).toHaveLength(0)
    await ingest(
      t,
      ev.deposited(READER, CENT, BigInt(11) * CENT, { ledger: LEDGER + 3 })
    )
    expect(await spendable(t, s)).toBe(BigInt(11) * CENT)
    expect(await releases(t)).toHaveLength(1)
  })

  it('the later absolute balance is indexed before the settler record (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    // The tip is still owed in the ledger: nothing free yet.
    expect(await spendable(t, s)).toBe(BigInt(0))
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    expect((await account(t)).settledUnindexed).toBe('0')
    await ingest(t, settledEvent(paid, { ledger: LEDGER + 1 }))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(10) * CENT).toString(),
      available: (BigInt(10) * CENT).toString(),
    })
    expect(flagged()).toEqual([])
  })

  it('a lost TabSettled and no later balance: the operator reconciliation, then the late event (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    const lost = settledEvent(paid, { ledger: LEDGER + 1 })
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    // Exact already (the balance is high by the same amount it reserves),
    // but the reserve never clears on its own.
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(15) * CENT).toString(),
      available: (BigInt(5) * CENT).toString(),
    })
    const read = {
      ledger: LEDGER + 3,
      balance: BigInt(5) * CENT,
      paid: new Map([[WRITER, BigInt(10) * CENT]]),
    }
    const dry = await reconcileAt(t, read, { apply: false })
    expect(dry).toMatchObject({
      status: 'dry_run',
      after: {
        confirmedBalance: (BigInt(5) * CENT).toString(),
        outstanding: '0',
        settledUnindexed: '0',
        spendable: (BigInt(5) * CENT).toString(),
      },
      pairs: [{ writer: WRITER, marked: (BigInt(10) * CENT).toString() }],
    })
    expect((await account(t)).settledUnindexed).toBe(
      (BigInt(10) * CENT).toString()
    )
    expect(await releases(t)).toHaveLength(0)

    expect(await reconcileAt(t, read)).toMatchObject({ status: 'applied' })
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      settledUnindexed: '0',
      balanceLedger: LEDGER + 3,
    })
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect(await releases(t)).toMatchObject([
      { source: 'reconcile', ledger: LEDGER + 3 },
    ])
    // Exactly once: a second run finds nothing.
    expect(await reconcileAt(t, read)).toMatchObject({
      status: 'nothing_to_do',
    })
    expect(await releases(t)).toHaveLength(1)
    // The missing event arrives late and is replayed: nothing changes.
    await ingest(t, lost)
    await ingest(t, lost)
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      available: (BigInt(5) * CENT).toString(),
    })
    // Later events apply as usual.
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 4,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('pre-change rows: a reserve of unknown age waits for the reconciliation (#573)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    // Rows as written before this change: no ledger on the pair or the
    // account, no start time on the reserve.
    await t.run(async (ctx) => {
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, { paidLedger: undefined })
      const row = (await ctx.db.query('tabAccounts').first())!
      await ctx.db.patch(row._id, {
        balanceLedger: undefined,
        settledUnindexedSince: undefined,
      })
    })
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    // Unknown age: kept (low, never above the chain).
    expect(await spendable(t, s)).toBe(BigInt(0))
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 2,
        balance: BigInt(10) * CENT,
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({ status: 'applied' })
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    // A pair written before #565 (no indexed ranges) counts as indexed.
    await t.run(async (ctx) => {
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, { indexedPaid: undefined })
    })
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 3,
        balance: BigInt(10) * CENT,
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({ status: 'nothing_to_do' })
  })

  it('an event that raises paid over a lost lower range bounds it by its own ledger (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    // Two settle_own payments by the writer, no settler record: 0.06 at
    // L+1 (event lost) and 0.04 at L+2 (indexed). Chain: 0.20, nothing owed.
    await ingest(
      t,
      ev.tabSettled(
        {
          cumulative: BigInt(10) * CENT,
          paidAfter: BigInt(10) * CENT,
          gross: BigInt(4) * CENT,
        },
        { ledger: LEDGER + 2 }
      )
    )
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
    expect((await voucherRow(t)).paidLedger).toBe(LEDGER + 2)
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(25) * CENT, {
        ledger: LEDGER + 3,
      })
    )
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(25) * CENT).toString(),
      settledUnindexed: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(25) * CENT)
    expect(flagged()).toEqual([])
  })

  it('a reserve of unknown age is bounded again by the next payment (#573)', async () => {
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    const first = await beginSettlement(t)
    await settlerRecord(t, first.settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    await t.run(async (ctx) => {
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, { paidLedger: undefined })
    })
    await tip(t, s, { cents: 5 })
    const second = await beginSettlement(t)
    await settlerRecord(
      t,
      second.settlementId,
      [
        {
          kind: 'settled',
          writer: WRITER,
          cumulative: BigInt(15) * CENT,
          paidAfter: BigInt(15) * CENT,
          gross: BigInt(5) * CENT,
        },
      ],
      LEDGER + 2
    )
    expect((await voucherRow(t)).paidLedger).toBe(LEDGER + 2)
    // Both events lost; a later deposit includes both debits.
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 3,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
  })

  it('two pairs of one reader: the whole reader, or one pair when the balance allows (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    await tip(t, s, { cents: 6, articleId: s.otherArticleId })
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(
      t,
      settlementId,
      [paidOf(WRITER, 10), paidOf(OTHER_WRITER, 6)],
      LEDGER + 1
    )
    // Both events lost; no later balance. Chain: 0.14, paid 0.10 and 0.06.
    expect(await spendable(t, s)).toBe(BigInt(14) * CENT)
    const paid = new Map([
      [WRITER, BigInt(10) * CENT],
      [OTHER_WRITER, BigInt(6) * CENT],
    ])
    const read = { ledger: LEDGER + 2, balance: BigInt(14) * CENT, paid }
    // One pair cannot explain the whole balance difference.
    expect(await reconcileAt(t, read, { writer: WRITER })).toMatchObject({
      status: 'refused',
      reason: 'BALANCE_MISMATCH',
    })
    expect(await reconcileAt(t, read)).toMatchObject({ status: 'applied' })
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(14) * CENT).toString(),
      settledUnindexed: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(14) * CENT)
    expect((await releases(t))[0]!.pairs).toHaveLength(2)
    expect(flagged()).toEqual([])
  })

  it('two pairs: one pair at a time once a later balance includes both debits (#573)', async () => {
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    await tip(t, s, { cents: 6, articleId: s.otherArticleId })
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(
      t,
      settlementId,
      [paidOf(WRITER, 10), paidOf(OTHER_WRITER, 6)],
      LEDGER + 1
    )
    await t.run(async (ctx) => {
      for (const pair of await ctx.db.query('tabVouchers').collect()) {
        await ctx.db.patch(pair._id, { paidLedger: undefined })
      }
    })
    await ingest(
      t,
      ev.deposited(READER, BigInt(6) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(4) * CENT)
    const read = {
      ledger: LEDGER + 2,
      balance: BigInt(20) * CENT,
      paid: new Map([
        [WRITER, BigInt(10) * CENT],
        [OTHER_WRITER, BigInt(6) * CENT],
      ]),
    }
    expect(await reconcileAt(t, read, { writer: WRITER })).toMatchObject({
      status: 'applied',
      pairs: [{ writer: WRITER }],
    })
    expect(await spendable(t, s)).toBe(BigInt(14) * CENT)
    expect(await reconcileAt(t, read, { writer: OTHER_WRITER })).toMatchObject({
      status: 'applied',
    })
    expect(await spendable(t, s)).toBe(BigInt(20) * CENT)
  })

  it('a lost settle_own event: the reconciliation applies the contract paid amount (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    // The writer settled on their own; the event was lost. No settler record.
    const own = settledEvent(paidOf(WRITER, 10), { ledger: LEDGER + 1 })
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(15) * CENT).toString(),
      outstanding: (BigInt(10) * CENT).toString(),
      available: (BigInt(5) * CENT).toString(),
    })
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 2,
        balance: BigInt(5) * CENT,
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({
      status: 'applied',
      pairs: [{ paidBefore: '0', paidAfter: (BigInt(10) * CENT).toString() }],
    })
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      outstanding: '0',
      available: (BigInt(5) * CENT).toString(),
    })
    expect(await receiptStatuses(t)).toEqual(['SETTLED'])
    expect((await voucherRow(t)).settleQueue).toBe('done')
    await ingest(t, own)
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    expect((await account(t)).confirmedBalance).toBe(
      (BigInt(5) * CENT).toString()
    )
    expect(flagged()).toEqual([])
  })

  it('a tab in CLOSING, then a withdrawal, inside the window (#573)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    await ingest(
      t,
      ev.withdrawStarted(BigInt(5) * CENT, LEDGER + 100, {
        ledger: LEDGER + 2,
      })
    )
    expect(await account(t)).toMatchObject({
      status: 'CLOSING',
      confirmedBalance: (BigInt(5) * CENT).toString(),
      settledUnindexed: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await ingest(t, ev.withdrawn(BigInt(5) * CENT, { ledger: LEDGER + 101 }))
    expect(await account(t)).toMatchObject({
      status: 'CLOSED',
      confirmedBalance: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(0))
    await ingest(t, settledEvent(paid, { ledger: LEDGER + 1 }))
    expect(await spendable(t, s)).toBe(BigInt(0))
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 102,
        balance: BigInt(0),
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({ status: 'nothing_to_do' })
    expect(flagged()).toEqual([])
  })

  it('a withdrawal with a reserve of unknown age: the reconciliation of a closed tab (#573)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    await t.run(async (ctx) => {
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, { paidLedger: undefined })
    })
    await ingest(
      t,
      ev.withdrawStarted(BigInt(5) * CENT, LEDGER + 100, {
        ledger: LEDGER + 2,
      }),
      ev.withdrawn(BigInt(5) * CENT, { ledger: LEDGER + 101 })
    )
    // Over-committed until reconciled: nothing spendable either way.
    expect(await spendable(t, s)).toBe(-BigInt(10) * CENT)
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 101,
        balance: BigInt(0),
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({ status: 'applied' })
    expect(await account(t)).toMatchObject({
      status: 'CLOSED',
      confirmedBalance: '0',
      settledUnindexed: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(0))
  })

  it('the reconciliation refuses what it cannot prove (#573)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    const before = await account(t)
    const read = (balance: number, paid = 10, ledger = LEDGER + 2) => ({
      ledger,
      balance: BigInt(balance) * CENT,
      paid: new Map([[WRITER, BigInt(paid) * CENT]]),
    })
    // The indexer has not reached the ledger the chain was read at.
    expect(
      await reconcileAt(t, read(5, 10, LEDGER + 50), { behind: true })
    ).toMatchObject({ status: 'refused', reason: 'INDEXER_BEHIND' })
    // The contract shows less paid than stored.
    expect(await reconcileAt(t, read(5, 6))).toMatchObject({
      status: 'refused',
      reason: 'MISMATCH_PAID',
    })
    // A balance difference the missing payments do not explain, either way.
    for (const balance of [2, 20]) {
      expect(await reconcileAt(t, read(balance))).toMatchObject({
        status: 'refused',
        reason: 'BALANCE_MISMATCH',
      })
    }
    // An event for this reader that was not applied.
    const row = await t.run(async (ctx) =>
      (await ctx.db.query('chainEvents').collect()).find(
        (e) => e.type === 'deposited'
      )
    )
    await t.run((ctx) => ctx.db.patch(row!._id, { handled: 'error' }))
    expect(await reconcileAt(t, read(5))).toMatchObject({
      status: 'refused',
      reason: 'EVENTS_UNHANDLED',
    })
    await t.run((ctx) => ctx.db.patch(row!._id, { handled: 'done' }))
    // The account changed between the snapshot and the reconciliation.
    await caughtUp(t, LEDGER + 2)
    const snap = (await t.query(internal.chain.tabReconcile.snapshot, {
      reader: READER,
    }))!
    await tip(t, s, { cents: 1 })
    expect(
      await t.mutation(internal.chain.tabReconcile.reconcile, {
        tabAccountId: snap.tabAccountId,
        digest: snap.digest,
        pairs: snap.pairs,
        chain: {
          ledger: LEDGER + 2,
          balance: (BigInt(5) * CENT).toString(),
          paid: snap.pairs.map((p) => ({
            ...p,
            paid: (BigInt(10) * CENT).toString(),
          })),
        },
        apply: true,
      })
    ).toMatchObject({ status: 'refused', reason: 'CHANGED' })
    // Nothing was written by any refusal.
    expect(await releases(t)).toHaveLength(0)
    expect((await account(t)).confirmedBalance).toBe(before.confirmedBalance)
    expect((await account(t)).settledUnindexed).toBe(before.settledUnindexed)
  })

  it('lists reserves that stay above 0 for more than an hour (#573)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    const list = () =>
      t.query(internal.chain.tabReconcile.listStaleReserves, {})
    expect(await list()).toEqual([])
    vi.setSystemTime(T0 + 2 * 60 * 60 * 1000)
    expect(await list()).toMatchObject([
      {
        readerAddress: READER,
        settledUnindexed: (BigInt(10) * CENT).toString(),
        since: expect.any(Number),
        pairs: [
          {
            writerAddress: WRITER,
            unindexed: (BigInt(10) * CENT).toString(),
            paidLedger: LEDGER + 1,
          },
        ],
      },
    ])
    const ops = () =>
      as(t, s.readerId).query(api.chain.tabReconcile.getStaleReserves, {})
    expect(await ops()).toBeNull()
    vi.stubEnv('OPS_USER_IDS', s.readerId)
    expect((await ops())?.rows).toHaveLength(1)
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    expect(await list()).toEqual([])
  })

  it.fails(
    'known issue: more than 256 debits after an absolute balance, then a re-dispatch of the oldest, debits it twice',
    async () => {
      const t = convexTest(schema, modules)
      await seed(t)
      const gross = BigInt(1000)
      const events = Array.from({ length: 257 }, (_, i) =>
        ev.tabSettled(
          {
            writer: OTHER_WRITER,
            cumulative: gross * BigInt(i + 1),
            paidAfter: gross * BigInt(i + 1),
            gross,
          },
          { ledger: LEDGER + 1 + i }
        )
      )
      for (let i = 0; i < events.length; i += 50) {
        await ingest(t, ...events.slice(i, i + 50))
      }
      const expected = (BigInt(10) * XLM - gross * BigInt(257)).toString()
      expect((await account(t)).confirmedBalance).toBe(expected)
      // The oldest debit is no longer in `settledSinceBalance` (256 kept).
      await t.run(async (ctx) => {
        const first = (
          await ctx.db
            .query('chainEvents')
            .withIndex('by_event_id', (q) => q.eq('eventId', events[0]!.id))
            .collect()
        )[0]!
        await ctx.db.patch(first._id, { handled: 'pending' })
      })
      await t.mutation(internal.chain.indexer.redispatch, {})
      expect((await account(t)).confirmedBalance).toBe(expected)
    }
  )

  it('review: property over settler, settle_own, shuffled and lost events, and reconciliations', async () => {
    const SEEDS = 40
    const STEPS = 60
    let worstGap = BigInt(0)
    const results: Record<string, number> = {}
    for (let seed = 101; seed < 101 + SEEDS; seed++) {
      const rand = prng(seed)
      const pick = (n: number) => Math.floor(rand() * n)
      // One seed in four loses some events for good.
      const lossy = seed % 4 === 0
      const flagged = negatives()
      const initial = BigInt(20) * CENT
      const { t, s } = await opened(initial, [])
      const writers = [
        { address: WRITER, articleId: s.articleId },
        { address: OTHER_WRITER, articleId: s.otherArticleId },
      ]
      const m: ChainModel = {
        balance: initial,
        paid: new Map(),
        accepted: new Map(),
      }
      // Ledger of the latest chain action; each action takes the next one.
      let chainLedger = LEDGER
      let lostDeposit = false
      const queue: RawRpcEvent[] = []
      const indexed: RawRpcEvent[] = []
      let record = null as {
        id: Id<'tabSettlements'>
        outcomes: Outcome[]
        ledger: number
      } | null
      const trace: string[] = []
      const check = async (step: string) => {
        trace.push(step)
        const free = await spendable(t, s)
        const truth = chainSpendable(m)
        if (free > truth) {
          throw new Error(
            `seed ${seed}: spendable ${free} > chain ${truth}\n${trace.join('\n')}`
          )
        }
        await screenSums(t, s)
      }
      const pay = (writer: string, cumulative: bigint) => {
        const paid = m.paid.get(writer) ?? BigInt(0)
        const delta = cumulative - paid
        const gross = delta < m.balance ? delta : m.balance
        if (delta <= BigInt(0)) return { skip: 3 }
        if (gross <= BigInt(0)) return { skip: 4 }
        m.balance -= gross
        m.paid.set(writer, paid + gross)
        return {
          o: {
            kind: 'settled' as const,
            writer,
            cumulative,
            paidAfter: paid + gross,
            gross,
          },
        }
      }
      /** Indexes `e`, or loses it for good on a lossy seed. */
      const deliver = async (e: RawRpcEvent) => {
        if (lossy && pick(4) === 0) {
          if (e.topic[0] === xdr.ScVal.scvSymbol('deposited').toXdr('base64')) {
            lostDeposit = true
          }
          await check('lost an event')
          return
        }
        await ingest(t, e)
        indexed.push(e)
      }
      /** The indexer catches up, then an operator reconciles at the tip. */
      const reconcile = async (apply: boolean) => {
        while (queue.length) {
          const [e] = queue.splice(pick(queue.length), 1)
          await deliver(e!)
        }
        const r = await reconcileAt(
          t,
          { ledger: chainLedger, balance: m.balance, paid: m.paid },
          { apply }
        )
        const key = r.status === 'refused' ? `refused ${r.reason}` : r.status
        results[key] = (results[key] ?? 0) + 1
        // Only a lost deposit leaves a difference it must not explain away.
        if (r.status === 'refused') {
          expect(
            r.reason === 'BALANCE_MISMATCH' && lostDeposit,
            `seed ${seed}: ${r.reason} ${r.detail}\n${trace.join('\n')}`
          ).toBe(true)
        }
        return r
      }
      for (let i = 0; i < STEPS; i++) {
        const op = pick(11)
        if (op <= 1) {
          const w = writers[pick(2)]!
          const cents = 1 + pick(8)
          const ok = await accepts(t, s, cents, w.articleId)
          if (ok) {
            const prev = m.accepted.get(w.address) ?? BigInt(0)
            m.accepted.set(w.address, prev + BigInt(cents) * CENT)
          }
          await check(`tip ${cents}c ${w.address.slice(0, 4)} ${ok}`)
        } else if (op === 2) {
          const amount = BigInt(1 + pick(10)) * CENT
          m.balance += amount
          queue.push(
            ev.deposited(READER, amount, m.balance, { ledger: ++chainLedger })
          )
          await check(`deposit ${amount}`)
        } else if (op === 3 && !record) {
          const ready = (await pairs(t)).filter(
            (v) => v.settleQueue === 'ready'
          )
          if (!ready.length) continue
          const { settlementId, vouchers } = await beginSettlement(t)
          const outcomes: Outcome[] = []
          const ledger = ++chainLedger
          for (const v of vouchers) {
            const r = pay(v.writerAddress, BigInt(v.cumulative))
            if (r.o) {
              outcomes.push(r.o)
              queue.push(settledEvent(r.o, { ledger }))
            } else {
              outcomes.push({
                kind: 'skipped',
                writer: v.writerAddress,
                cumulative: BigInt(v.cumulative),
                reason: r.skip!,
              })
            }
          }
          record = { id: settlementId, outcomes, ledger }
          await check(`settle ${outcomes.length}`)
        } else if (op === 4) {
          // The writer's settle_own with the latest voucher: no record.
          const w = writers[pick(2)]!
          const row = (await pairs(t)).find(
            (v) => v.writerAddress === w.address
          )
          if (!row) continue
          const r = pay(w.address, BigInt(row.cumulative))
          if (r.o) queue.push(settledEvent(r.o, { ledger: ++chainLedger }))
          await check(
            `settle_own ${w.address.slice(0, 4)} ${r.o ? r.o.gross : 'skip'}`
          )
        } else if (op === 5 && record) {
          await settlerRecord(t, record.id, record.outcomes, record.ledger)
          if (pick(3) === 0) {
            await settlerRecord(t, record.id, record.outcomes, record.ledger)
          }
          record = null
          await check('record')
        } else if (op === 6 && queue.length) {
          // Out of order: any queued event.
          const [e] = queue.splice(pick(queue.length), 1)
          await deliver(e!)
          await check('index one, shuffled')
        } else if (op === 7 && indexed.length) {
          await ingest(t, indexed[pick(indexed.length)]!)
          await check('replay')
        } else if (op === 8 && indexed.length) {
          await t.run(async (ctx) => {
            const rows = await ctx.db.query('chainEvents').collect()
            const row = rows[Math.floor(rand() * rows.length)]
            if (row) await ctx.db.patch(row._id, { handled: 'pending' })
          })
          await t.mutation(internal.chain.indexer.redispatch, {})
          await check('redispatch')
        } else if (op === 9) {
          await check('wait')
        } else if (op === 10) {
          const r = await reconcile(pick(4) !== 0)
          await check(`reconcile ${r.status}`)
        }
      }
      if (record) {
        await settlerRecord(t, record.id, record.outcomes, record.ledger)
      }
      while (queue.length) {
        const [e] = queue.splice(pick(queue.length), 1)
        await ingest(t, e!)
      }
      await check('drain')
      const tab = await myTab(t, s)
      if (!lossy) {
        expect(BigInt(tab.available), `seed ${seed}`).toBe(chainSpendable(m))
        expect(BigInt(tab.confirmedBalance), `seed ${seed}`).toBe(m.balance)
        expect((await account(t)).settledUnindexed ?? '0', `seed ${seed}`).toBe(
          '0'
        )
      } else {
        const gap = chainSpendable(m) - BigInt(tab.available)
        if (gap > worstGap) worstGap = gap
        // Lost events: the reconciliation makes the ledger exact again,
        // unless a lost deposit leaves a difference it must refuse.
        const r = await reconcile(true)
        await check(`final reconcile ${r.status}`)
        if (r.status !== 'refused') {
          const fixed = await myTab(t, s)
          expect(BigInt(fixed.available), `seed ${seed}`).toBe(
            chainSpendable(m)
          )
          expect(BigInt(fixed.confirmedBalance), `seed ${seed}`).toBe(m.balance)
          expect(
            (await account(t)).settledUnindexed ?? '0',
            `seed ${seed}`
          ).toBe('0')
        }
      }
      expect(flagged(), `seed ${seed}`).toEqual([])
      vi.restoreAllMocks()
    }
    console.info(
      `review property: worst lossy gap ${worstGap}; reconciliations ${JSON.stringify(results)}`
    )
  }, 600_000)
})
