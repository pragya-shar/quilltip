/// <reference types="vite/client" />
/**
 * Shared tab ledger fixtures for the convex-test suites (`tab-ledger.test.ts`,
 * `money-views.test.ts`): the reader, writer, keys, tab contract and
 * receipts from `contracts/shared/test-vectors.json`, Tab events in the RPC
 * shape, a seeded deployment, and the prepare, sign and submit steps.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, vi } from 'vitest'
import { Buffer } from 'buffer'
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import { DAY_LEDGERS } from '../../convex/lib/chain/tabLedger'
import {
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadBytes,
  type StoredReceipt,
} from '../../convex/lib/chain/voucher'
import { hexToBytes, bytesToHex } from '../../convex/lib/chain/ids'
import { signEd25519 } from '../../lib/stellar/v2/tab/encoding'
import type { SessionKeyScope } from '../../lib/stellar/v2/tab'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { seedAddress } from './fixtures'

export const modules = import.meta.glob('../../convex/**/*.ts')

export const EPOCH = 'testnet-tab'
export const PASSPHRASE = shared.network.passphrase
export const TAB = shared.tab_contract
export const TOKEN = 'CAJS4RVGLFL2ANWW7W6Q4RGOZQXSVXW5BQKJ7A3ISE4EOUM5HHO77CQL'
export const READER = shared.vouchers[0]!.reader
export const WRITER = shared.vouchers[0]!.writer
export const CLIENT_SCOPE: SessionKeyScope = {
  tabContractId: TAB,
  readerAddress: READER,
}
export const OTHER_WRITER = seedAddress(41)
export const SESSION_SEED = hexToBytes(shared.keys.session.seed)
export const SESSION_PUBLIC = shared.keys.session.public_key
export const ACCEPTOR_PUBLIC = shared.keys.acceptor.public_key
export const VECTOR_RECEIPTS = shared.receipts.items
export const HIGHLIGHT = {
  text: 'The quick brown fox jumps over the lazy dog',
  startOffset: 120,
  endOffset: 163,
}
export const LEDGER = 7_000_000
export const VALID_UNTIL = LEDGER + 7 * DAY_LEDGERS
export const T0 = Date.UTC(2026, 11, 2, 12, 0, 0)
export const XLM = BigInt(10_000_000)

/** Registers the tab environment, fake timers and cleanup for a suite. */
export function withTabEnv() {
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
}

export type T = ReturnType<typeof convexTest>

// ---------------------------------------------------------------------------
// Fixtures

export let eventSeq = 0

export function eventId(ledger: number): string {
  eventSeq += 1
  return rpcEventId(ledger, eventSeq, 0, 0)
}

export type ScEntry = [string, xdr.ScVal]

/** A Tab event in the `getEvents` shape: topics, then a map of fields. */
export function tabEvent(
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

export const i128 = (n: bigint | number) =>
  nativeToScVal(BigInt(n), { type: 'i128' })
export const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })
export const bytes = (h: string) =>
  xdr.ScVal.scvBytes(Buffer.from(hexToBytes(h)))

export const ev = {
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

export async function ingest(t: T, ...events: RawRpcEvent[]) {
  return t.mutation(internal.chain.indexer.ingestBackfill, { events })
}

export async function setLedger(t: T, latestLedger: number) {
  await t.run(async (ctx) => {
    const cursor = await ctx.db.query('chainCursor').first()
    await ctx.db.patch(cursor!._id, { latestLedger, updatedAt: Date.now() })
  })
}

/** Users, a registered article, config, cursor, price, and an open tab. */
export async function seed(t: T, options: { open?: boolean } = {}) {
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

export type Seeded = Awaited<ReturnType<typeof seed>>

export const as = (t: T, userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

/** Makes `newClientRefHex` return the vector client refs in order. */
export function useVectorClientRefs() {
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

export let requestSeq = 0

export type Prepared = {
  prepareId: Id<'tips'> | Id<'highlightTips'>
  receipt: StoredReceipt
  leafHashes: string[]
  writer: string
  keyId: number
  tabContractId: string
}

export async function prepare(
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
export function sign(p: Prepared, reader = READER, seed = SESSION_SEED) {
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

export async function submit(
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

export async function tip(
  t: T,
  s: Seeded,
  o: Parameters<typeof prepare>[2] = {}
) {
  return submit(t, s, await prepare(t, s, o))
}

export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: unknown }).data
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    return (parsed as { code?: string })?.code ?? String(error)
  }
  return 'no error'
}

export async function account(t: T) {
  return t.run(async (ctx) => (await ctx.db.query('tabAccounts').first())!)
}
export async function voucherRow(t: T, writer = WRITER) {
  return t.run(
    async (ctx) =>
      (await ctx.db.query('tabVouchers').collect()).find(
        (row) => row.writerAddress === writer
      )!
  )
}
export async function receiptStatuses(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query('tabReceipts').collect())
      .sort((a, b) => a.seq - b.seq)
      .map((r) => r.status)
  )
}
export async function earnings(t: T, userId: Id<'users'>) {
  return t.run(async (ctx) =>
    (await ctx.db.query('authorEarnings').collect()).find(
      (row) => row.userId === userId
    )
  )
}
