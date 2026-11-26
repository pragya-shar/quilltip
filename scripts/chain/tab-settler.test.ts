/// <reference types="vite/client" />
/**
 * Tab settler (#465): due rules and ordering, the settler lease, pre-checks,
 * bisection, per-voucher outcomes, crash and RPC-failure recovery, window
 * expiry, starvation, and the guard. The chain is a fake Tab that applies the
 * contract's `settle` rules (03-tab-contract.md, section 3.2) and returns the
 * same `TabSettled` and `VoucherSkipped` events.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'buffer'
import {
  Address,
  Keypair,
  StrKey,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { ActionCtx, MutationCtx } from '../../convex/_generated/server'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import {
  DUE_AGE_MS,
  EXPIRING_LEDGERS,
  MAX_SETTLE_BATCH,
  dueReasons,
  orderDue,
  runSettlementCycle,
  type LookupOutcome,
  type PreparedSubmission,
  type SettleCandidate,
  type SettleVoucher,
  type SettlementSubmitter,
  type SettlerDeps,
} from '../../convex/lib/chain/settler'
import {
  DAY_LEDGERS,
  SETTLE_GRACE_LEDGERS,
  netOf,
} from '../../convex/lib/chain/tabLedger'
import {
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadBytes,
  type StoredReceipt,
} from '../../convex/lib/chain/voucher'
import { bytesToHex, hexToBytes } from '../../convex/lib/chain/ids'
import { convexSettlementLedger, settlerConfig } from '../../convex/tabSettler'
import { signEd25519 } from '../../lib/stellar/v2/tab/encoding'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { fakeRpcFetch } from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

/** `t.run` with the app's typed database context. */
function run<R>(
  t: { run: (fn: never) => Promise<unknown> },
  fn: (ctx: MutationCtx) => Promise<R>
): Promise<R> {
  return t.run(fn as never) as Promise<R>
}

const EPOCH = 'testnet-settle'
const PASSPHRASE = 'Test SDF Network ; September 2015'
const TAB = shared.tab_contract
const TOKEN = 'CAJS4RVGLFL2ANWW7W6Q4RGOZQXSVXW5BQKJ7A3ISE4EOUM5HHO77CQL'
const SESSION_SEED = hexToBytes(shared.keys.session.seed)
const SESSION_PUBLIC = shared.keys.session.public_key
const LEDGER = 7_000_000
const T0 = Date.UTC(2026, 11, 2, 12, 0, 0)
const XLM = BigInt(10_000_000)
const SETTLER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(61))
const fee = (x: bigint) => (x * BigInt(250)) / BigInt(10_000)

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

// ---------------------------------------------------------------------------
// Ledger fixtures: accounts, keys, receipts and signed vouchers.

type PairOptions = {
  reader?: string
  writer?: string
  keyId?: number
  amounts?: bigint[]
  /** Age of the oldest receipt. */
  ageMs?: number
  /** Ledgers from LEDGER to the window end. */
  windowLedgers?: number
  accountStatus?: 'OPEN' | 'CLOSING' | 'CLOSED'
  queue?: 'ready' | 'blocked'
  /** A voucher whose signature does not verify. */
  badSignature?: boolean
}

type Pair = {
  voucherId: Id<'tabVouchers'>
  accountId: Id<'tabAccounts'>
  reader: string
  writer: string
  keyId: number
  cumulative: bigint
}

const newAddress = () => Keypair.random().publicKey()

async function userFor(t: T, address: string, now: number) {
  return run(t, async (ctx) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_stellar_address', (q) => q.eq('stellarAddress', address))
      .first()
    if (existing) return existing._id
    return ctx.db.insert('users', {
      username: `u${address.slice(1, 9).toLowerCase()}`,
      email: `${address.slice(1, 9).toLowerCase()}@example.test`,
      stellarAddress: address,
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: PASSPHRASE,
      createdAt: now,
      updatedAt: now,
    })
  })
}

async function seedPair(t: T, o: PairOptions = {}): Promise<Pair> {
  const now = Date.now()
  const reader = o.reader ?? newAddress()
  const writer = o.writer ?? newAddress()
  const keyId = o.keyId ?? 0
  const amounts = o.amounts ?? [XLM]
  const settleBy = LEDGER + (o.windowLedgers ?? 20 * DAY_LEDGERS)
  const acceptedAt = now - (o.ageMs ?? 60_000)
  const readerId = await userFor(t, reader, now)
  const writerId = await userFor(t, writer, now)

  let cumulative = BigInt(0)
  const receipts: StoredReceipt[] = amounts.map((amount, i) => {
    cumulative += amount
    return {
      amount: amount.toString(),
      articleId: 'aa'.repeat(32),
      clientRef: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
      contentHash: 'bb'.repeat(32),
      cumulativeAfter: cumulative.toString(),
      highlightId: null,
      seq: i + 1,
    }
  })
  const leafHashes = receipts.map(receiptLeafHex)
  const receiptsRoot = receiptsRootHex(leafHashes)
  const payload = voucherPayloadBytes({
    tab: TAB,
    networkId: networkIdOf(PASSPHRASE),
    reader,
    writer,
    keyId,
    publicKey: hexToBytes(SESSION_PUBLIC),
    cumulative: o.badSignature ? cumulative + BigInt(1) : cumulative,
    receiptsRoot: hexToBytes(receiptsRoot),
  })
  const signature = bytesToHex(signEd25519(SESSION_SEED, payload))

  const ids = await run(t, async (ctx) => {
    const db = ctx.db
    let account = (
      await db
        .query('tabAccounts')
        .withIndex('by_reader', (q) => q.eq('readerAddress', reader))
        .collect()
    )[0]
    if (!account) {
      const id = await db.insert('tabAccounts', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        userId: readerId,
        readerAddress: reader,
        tabContractId: TAB,
        status: o.accountStatus ?? 'OPEN',
        confirmedBalance: (BigInt(1_000) * XLM).toString(),
        outstanding: '0',
        acceptedToday: '0',
        acceptedDay: '2026-12-02',
        settledSinceBalance: [],
        pendingKeys: [],
        createdAt: now,
        updatedAt: now,
      })
      account = (await db.get(id))!
    }
    await db.patch(account._id, {
      outstanding: (BigInt(account.outstanding) + cumulative).toString(),
    })
    const key = await db
      .query('tabSessionKeys')
      .withIndex('by_account_key', (q) =>
        q.eq('tabAccountId', account!._id).eq('keyId', keyId)
      )
      .first()
    if (!key) {
      await db.insert('tabSessionKeys', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        tabAccountId: account._id,
        keyId,
        publicKey: SESSION_PUBLIC,
        validUntilLedger: settleBy - SETTLE_GRACE_LEDGERS,
        spendLimit: (BigInt(1_000) * XLM).toString(),
        spentOnChain: '0',
        acceptedTotal: cumulative.toString(),
        revoked: false,
        extractable: false,
        createdAt: now,
        updatedAt: now,
      })
    }
    const articleId = await db.insert('articles', {
      slug: `a-${receipts[0]!.clientRef}`,
      title: 'A',
      content: { type: 'doc', content: [] },
      published: true,
      authorId: writerId,
      authorUsername: 'w',
      createdAt: now,
      updatedAt: now,
    })
    for (const r of receipts) {
      const tipRowId = await db.insert('tips', {
        articleId,
        tipperId: readerId,
        authorId: writerId,
        articleTitle: 'A',
        articleSlug: 'a',
        amountUsd: 0.1,
        amountCents: 10,
        status: 'ACCEPTED',
        contractVersion: 'v2',
        channel: 'tab',
        clientRef: r.clientRef,
        grossBaseUnits: r.amount,
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      })
      await db.insert('tabReceipts', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        tabAccountId: account._id,
        keyId,
        writerAddress: writer,
        authorId: writerId,
        articleId,
        articleKey: r.articleId,
        seq: r.seq,
        amount: r.amount,
        cumulativeAfter: r.cumulativeAfter,
        clientRef: r.clientRef,
        contentHash: r.contentHash,
        leafHash: receiptLeafHex(r),
        tipRowId,
        status: 'ACCEPTED',
        receiptsRoot,
        voucherSignature: signature,
        acceptorPublicKey: 'cc'.repeat(32),
        acceptanceSignature: 'dd'.repeat(64),
        acceptedAt,
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      })
    }
    const voucherId = await db.insert('tabVouchers', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      tabAccountId: account._id,
      tabContractId: TAB,
      tokenContractId: TOKEN,
      readerAddress: reader,
      keyId,
      writerAddress: writer,
      authorId: writerId,
      cumulative: cumulative.toString(),
      receiptsRoot,
      leafHashes,
      signature,
      acceptance: { acceptor: 'cc'.repeat(32), signature: 'dd'.repeat(64) },
      seq: receipts.length,
      paidOnChain: '0',
      unsettled: true,
      oldestUnsettledAt: acceptedAt,
      settleBy,
      settleQueue: o.queue ?? 'ready',
      state: 'ACTIVE',
      earnedNet: '0',
      pendingNet: '0',
      acceptedAt,
      updatedAt: now,
    })
    return { voucherId, accountId: account._id }
  })
  return { ...ids, reader, writer, keyId, cumulative }
}

// ---------------------------------------------------------------------------
// A fake Tab: the contract's settle rules and events.

type Applied = { name: string; topics: xdr.ScVal[]; data: xdr.ScVal }

function eventXdr(e: Applied): string {
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new xdr.ContractId(StrKey.decodeContract(TAB)),
    type: xdr.ContractEventType['contract'],
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({ topics: e.topics, data: e.data })
    ),
  }).toXdr('base64')
}

const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })

function mapOf(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(
        ([key, val]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
      )
  )
}

class FakeTab {
  ledger = LEDGER
  closeTime = Math.floor(T0 / 1000)
  paid = new Map<string, bigint>()
  balance = new Map<string, bigint>()
  expiredKeys = new Set<string>()
  poisoned = new Set<string>()
  txs = new Map<
    string,
    { vouchers: SettleVoucher[]; included: boolean; events: Applied[] }
  >()
  calls = { simulate: 0, prepare: 0, send: 0, lookup: 0 }
  /** Lookups answer `pending` while this is above 0. */
  pendingLookups = 0
  lookupThrows = 0
  sendTransient = 0
  prepareThrows = false
  simulateTransient = 0
  /** Every simulation fails with this contract error (a batch-wide cause). */
  simulateSystemic: string | null = null
  /** A sent transaction is included only after this many more lookups. */
  includeAfter = 0
  txSeq = 0

  pairKey(v: SettleVoucher) {
    return `${v.reader}|${v.keyId}|${v.writer}`
  }

  apply(vouchers: SettleVoucher[]): Applied[] {
    const events: Applied[] = []
    for (const v of vouchers) {
      const topics = (name: string) => [
        xdr.ScVal.scvSymbol(name),
        new Address(v.reader).toScVal(),
        new Address(v.writer).toScVal(),
      ]
      const skip = (reason: number) =>
        events.push({
          name: 'voucher_skipped',
          topics: topics('voucher_skipped'),
          data: mapOf([
            ['key_id', u32(v.keyId)],
            ['cumulative', i128(v.cumulative)],
            ['reason', u32(reason)],
          ]),
        })
      if (this.expiredKeys.has(`${v.reader}|${v.keyId}`)) {
        skip(2)
        continue
      }
      const paid = this.paid.get(this.pairKey(v)) ?? BigInt(0)
      if (v.cumulative <= paid) {
        skip(3)
        continue
      }
      const balance = this.balance.get(v.reader) ?? BigInt(1_000) * XLM
      const delta = v.cumulative - paid
      const gross = delta < balance ? delta : balance
      if (gross === BigInt(0)) {
        skip(4)
        continue
      }
      const paidAfter = paid + gross
      this.paid.set(this.pairKey(v), paidAfter)
      this.balance.set(v.reader, balance - gross)
      events.push({
        name: 'tab_settled',
        topics: topics('tab_settled'),
        data: mapOf([
          ['key_id', u32(v.keyId)],
          ['cumulative', i128(v.cumulative)],
          ['paid_after', i128(paidAfter)],
          ['gross', i128(gross)],
          ['fee', i128(fee(paidAfter) - fee(paid))],
          ['receipts_root', xdr.ScVal.scvBytes(Buffer.from(v.receiptsRoot))],
          ['by_writer', xdr.ScVal.scvBool(false)],
        ]),
      })
    }
    return events
  }

  /** The events of all included transactions in `getEvents` form. */
  rpcEvents(): RawRpcEvent[] {
    const out: RawRpcEvent[] = []
    let tx = 0
    for (const [hash, record] of this.txs) {
      tx++
      if (!record.included) continue
      record.events.forEach((e, i) =>
        out.push({
          type: 'contract',
          ledger: this.ledger,
          ledgerClosedAt: new Date(T0).toISOString(),
          contractId: TAB,
          id: rpcEventId(this.ledger, tx, 0, i),
          txHash: hash,
          topic: e.topics.map((x) => x.toXdr('base64')),
          value: e.data.toXdr('base64'),
          inSuccessfulContractCall: true,
        })
      )
    }
    return out
  }

  submitter(): SettlementSubmitter {
    return {
      kind: 'localKey',
      settlerAddress: SETTLER.publicKey(),
      simulate: async (vouchers) => {
        this.calls.simulate++
        if (this.simulateTransient > 0) {
          this.simulateTransient--
          return { ok: false, kind: 'transient', message: 'RPC 503' }
        }
        if (this.simulateSystemic) {
          return { ok: false, kind: 'contract', message: this.simulateSystemic }
        }
        if (vouchers.some((v) => this.poisoned.has(v.writer))) {
          return {
            ok: false,
            kind: 'contract',
            message: 'HostError: Error(Crypto, InvalidInput)',
          }
        }
        return { ok: true }
      },
      prepare: async (vouchers): Promise<PreparedSubmission> => {
        this.calls.prepare++
        if (this.prepareThrows) throw new Error('process stopped')
        const hash = (++this.txSeq).toString(16).padStart(64, '0')
        this.txs.set(hash, { vouchers, included: false, events: [] })
        return { reference: hash, txHash: hash, envelopeXdr: `env-${hash}` }
      },
      send: async (prepared) => {
        this.calls.send++
        if (this.sendTransient > 0) {
          this.sendTransient--
          return { status: 'transient', message: 'TRY_AGAIN_LATER' }
        }
        const record = this.txs.get(prepared.reference)!
        if (!record.included) {
          record.included = true
          record.events = this.apply(record.vouchers)
        }
        return { status: 'sent' }
      },
      lookup: async (prepared): Promise<LookupOutcome> => {
        this.calls.lookup++
        if (this.lookupThrows > 0) {
          this.lookupThrows--
          throw new Error('RPC getTransaction returned HTTP 503')
        }
        if (this.pendingLookups > 0) {
          this.pendingLookups--
          return { status: 'pending' }
        }
        const record = this.txs.get(prepared.reference)
        if (!record || !record.included) return { status: 'not_found' }
        return {
          status: 'success',
          txHash: prepared.reference,
          ledger: this.ledger,
          contractEventsXdr: [record.events.map(eventXdr)],
        }
      },
      balance: async () => BigInt(100) * XLM,
    }
  }
}

function ledgerOf(t: T) {
  return convexSettlementLedger({
    runQuery: (ref: unknown, args: unknown) =>
      (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
    runMutation: (ref: unknown, args: unknown) =>
      (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
  } as unknown as ActionCtx)
}

/** Sets the indexer cursor to `ledger` (inserting it if needed). */
async function indexedThrough(t: T, ledger: number) {
  await run(t, async (ctx) => {
    const cursor = await ctx.db.query('chainCursor').first()
    const fields = {
      network: 'TESTNET' as const,
      chainEpoch: EPOCH,
      lastLedger: ledger,
      lastLedgerCloseTime: Math.floor(Date.now() / 1000),
      latestLedger: ledger,
      oldestLedger: ledger - 100_000,
      lagLedgers: 0,
      status: 'OK' as const,
      updatedAt: Date.now(),
    }
    if (cursor) await ctx.db.patch(cursor._id, fields)
    else await ctx.db.insert('chainCursor', fields)
  })
}

function depsFor(
  t: T,
  fake: FakeTab,
  over: Partial<SettlerDeps> = {}
): SettlerDeps & { logs: Array<Record<string, unknown>> } {
  const logs: Array<Record<string, unknown>> = []
  return {
    holder: `holder-${Math.random().toString(36).slice(2)}`,
    passphrase: PASSPHRASE,
    tabContractId: TAB,
    ledger: ledgerOf(t),
    latestLedger: async () => {
      // A caught-up indexer: its cursor has processed the latest ledger.
      if (!over.latestLedger) await indexedThrough(t, fake.ledger)
      return { sequence: fake.ledger, closeTime: fake.closeTime }
    },
    submitter: fake.submitter(),
    now: () => Date.now(),
    log: (code, details) => logs.push({ code, ...details }),
    sleep: async () => {},
    pollAttempts: 2,
    logs,
    ...over,
  }
}

async function voucher(t: T, id: Id<'tabVouchers'>) {
  return run(t, async (ctx) => (await ctx.db.get(id))!)
}
async function receipts(t: T, pair: Pair) {
  return run(t, async (ctx) =>
    (
      await ctx.db
        .query('tabReceipts')
        .withIndex('by_pair_seq', (q) =>
          q
            .eq('tabAccountId', pair.accountId)
            .eq('keyId', pair.keyId)
            .eq('writerAddress', pair.writer)
        )
        .collect()
    ).map((r) => r.status)
  )
}
async function settlements(t: T) {
  return run(t, async (ctx) => ctx.db.query('tabSettlements').collect())
}

const OLD = DUE_AGE_MS + 60_000

// ---------------------------------------------------------------------------

describe('due rules and ordering', () => {
  const base = (o: Partial<SettleCandidate>): SettleCandidate => ({
    voucherId: 'v',
    chainEpoch: EPOCH,
    voucher: {} as SettleCandidate['voucher'],
    paidOnChain: '0',
    unsettledAmount: '1000000',
    oldestUnsettledAt: T0 - 60_000,
    accountStatus: 'OPEN',
    settleBy: LEDGER + 20 * DAY_LEDGERS,
    ...o,
  })
  const at = { ledger: LEDGER, now: T0 }

  it('applies the four due rules of section 3.8', () => {
    expect(dueReasons(base({}), at)).toEqual([])
    expect(dueReasons(base({ accountStatus: 'CLOSING' }), at)).toEqual([
      'closing',
    ])
    expect(
      dueReasons(base({ settleBy: LEDGER + EXPIRING_LEDGERS }), at)
    ).toEqual(['expiring'])
    expect(dueReasons(base({ oldestUnsettledAt: T0 - OLD }), at)).toEqual([
      'age',
    ])
    expect(dueReasons(base({ unsettledAmount: '50000000' }), at)).toEqual([
      'amount',
    ])
    expect(dueReasons(base({ unsettledAmount: '49999999' }), at)).toEqual([])
  })

  it('orders closing tabs first, then the soonest window end, then age', () => {
    const order = orderDue(
      [
        base({ voucherId: 'old', oldestUnsettledAt: T0 - OLD - 1000 }),
        base({
          voucherId: 'big',
          unsettledAmount: '60000000',
          settleBy: LEDGER + 10 * DAY_LEDGERS,
        }),
        base({ voucherId: 'young' }),
        base({ voucherId: 'expiring', settleBy: LEDGER + DAY_LEDGERS }),
        base({
          voucherId: 'closing',
          accountStatus: 'CLOSING',
          settleBy: LEDGER + 25 * DAY_LEDGERS,
        }),
        base({ voucherId: 'older', oldestUnsettledAt: T0 - OLD - 5000 }),
      ],
      at
    )
    expect(order.map((c) => c.voucherId)).toEqual([
      'closing',
      'expiring',
      'big',
      'older',
      'old',
    ])
  })

  it('submits due pairs in that order, at most 32 per settlement', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const young = await seedPair(t)
    const closing = await seedPair(t, { accountStatus: 'CLOSING' })
    const expiring = await seedPair(t, { windowLedgers: DAY_LEDGERS })
    const aged = await Promise.all(
      Array.from({ length: 35 }, () => seedPair(t, { ageMs: OLD }))
    )
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r).toMatchObject({
      status: 'confirmed',
      submitted: MAX_SETTLE_BATCH,
    })
    const [tx] = [...fake.txs.values()]
    expect(tx!.vouchers.slice(0, 2).map((v) => v.writer)).toEqual([
      closing.writer,
      expiring.writer,
    ])
    expect(tx!.vouchers.map((v) => v.writer)).not.toContain(young.writer)
    expect((await voucher(t, young.voucherId)).settleQueue).toBe('ready')
    // The next run settles the remaining aged pairs.
    const next = await runSettlementCycle(depsFor(t, fake))
    expect(next).toMatchObject({ status: 'confirmed', submitted: 5 })
    for (const p of aged) {
      expect(await voucher(t, p.voucherId)).toMatchObject({
        paidOnChain: p.cumulative.toString(),
        settleQueue: 'done',
        unsettled: false,
      })
    }
  })
})

describe('settlement', () => {
  it('settles, applies the outcome, and the indexed events agree to the stroop', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const reader = newAddress()
    const a = await seedPair(t, {
      reader,
      amounts: [XLM, BigInt(39)],
      ageMs: OLD,
    })
    const b = await seedPair(t, {
      reader,
      amounts: [BigInt(3) * XLM],
      ageMs: OLD,
    })
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r.status).toBe('confirmed')
    const [s] = await settlements(t)
    expect(s).toMatchObject({
      status: 'CONFIRMED',
      settled: 2,
      skipped: 0,
      gross: (a.cumulative + b.cumulative).toString(),
      fee: (fee(a.cumulative) + fee(b.cumulative)).toString(),
    })
    for (const p of [a, b]) {
      expect(await voucher(t, p.voucherId)).toMatchObject({
        paidOnChain: p.cumulative.toString(),
        earnedNet: netOf(p.cumulative).toString(),
        pendingNet: '0',
        settleQueue: 'done',
      })
      expect((await receipts(t, p)).every((x) => x === 'SETTLED')).toBe(true)
    }
    const account = await run(t, async (ctx) => ctx.db.get(a.accountId))
    expect(account!.outstanding).toBe('0')

    // The indexer applies the same events: balance debited once, nothing else moves.
    const before = await voucher(t, a.voucherId)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: fake.rpcEvents(),
    })
    const after = await run(t, async (ctx) => ctx.db.get(a.accountId))
    expect(after!.confirmedBalance).toBe(
      (BigInt(1_000) * XLM - a.cumulative - b.cumulative).toString()
    )
    expect(after!.outstanding).toBe('0')
    expect(await voucher(t, a.voucherId)).toMatchObject({
      paidOnChain: before.paidOnChain,
      earnedNet: before.earnedNet,
    })
  })

  it('takes the settler lease: of two concurrent runs, one settles', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    await seedPair(t, { ageMs: OLD })
    await seedPair(t, { ageMs: OLD })
    const [x, y] = await Promise.all([
      runSettlementCycle(depsFor(t, fake)),
      runSettlementCycle(depsFor(t, fake)),
    ])
    expect([x.status, y.status].sort()).toEqual(['busy', 'confirmed'])
    expect(fake.calls.prepare).toBe(1)
    expect(await settlements(t)).toHaveLength(1)
    // The lease is released after the run.
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe(
      'nothing_due'
    )
  })

  it('rejects a voucher whose signature fails the pre-check, and settles the rest', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const bad = await seedPair(t, { ageMs: OLD, badSignature: true })
    const good = await seedPair(t, { ageMs: OLD })
    const deps = depsFor(t, fake)
    const r = await runSettlementCycle(deps)
    expect(r).toMatchObject({ status: 'confirmed', submitted: 1, rejected: 1 })
    expect(await voucher(t, bad.voucherId)).toMatchObject({
      state: 'REJECTED',
      rejectedReason: 'precheck:signature',
      settleQueue: 'done',
      pendingNet: '0',
    })
    expect(await receipts(t, bad)).toEqual(['REJECTED'])
    expect((await voucher(t, good.voucherId)).paidOnChain).toBe(
      good.cumulative.toString()
    )
    expect(deps.logs.map((l) => l.code)).toContain('TAB_SETTLER_REJECTED')
    const account = await run(t, async (ctx) => ctx.db.get(bad.accountId))
    expect(account!.outstanding).toBe('0')
  })

  it('bisects a failing simulation down to the one bad voucher', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const pairs = await Promise.all(
      Array.from({ length: 8 }, () => seedPair(t, { ageMs: OLD }))
    )
    fake.poisoned.add(pairs[5]!.writer)
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r).toMatchObject({ status: 'confirmed', submitted: 7, rejected: 1 })
    // 8 → 4+4 → 2+2 → 1+1, then the union of the good ones once more.
    expect(fake.calls.simulate).toBe(8)
    expect(await voucher(t, pairs[5]!.voucherId)).toMatchObject({
      state: 'REJECTED',
      rejectedReason: expect.stringContaining('simulation:'),
    })
    for (const [i, p] of pairs.entries()) {
      if (i === 5) continue
      expect((await voucher(t, p.voucherId)).paidOnChain).toBe(
        p.cumulative.toString()
      )
    }
  })

  it('rejects nothing when every voucher fails for a reason no voucher explains', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const pairs = await Promise.all(
      Array.from({ length: 4 }, () => seedPair(t, { ageMs: OLD }))
    )
    // For example the settler role was revoked: every simulation traps alike.
    fake.simulateSystemic = 'HostError: Error(Contract, #2000)'
    const deps = depsFor(t, fake)
    const r = await runSettlementCycle(deps)
    expect(r).toMatchObject({ status: 'failed', submitted: 0, rejected: 0 })
    expect(deps.logs).toContainEqual(
      expect.objectContaining({ code: 'TAB_SETTLER_SIMULATION_FAILED' })
    )
    for (const p of pairs) {
      expect(await voucher(t, p.voucherId)).toMatchObject({
        state: 'ACTIVE',
        settleQueue: 'ready',
      })
    }
    expect(fake.calls.send).toBe(0)
    // Once the cause is fixed, the same pairs settle.
    fake.simulateSystemic = null
    const again = await runSettlementCycle(depsFor(t, fake))
    expect(again).toMatchObject({ status: 'confirmed', submitted: 4 })
  })

  it('applies partial outcomes: SHORTFALL parks the pair until a deposit, KEY_EXPIRED is UNPAID, STALE counts as paid', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const short = await seedPair(t, { ageMs: OLD, amounts: [XLM, XLM] })
    const expired = await seedPair(t, { ageMs: OLD })
    const stale = await seedPair(t, { ageMs: OLD })
    const fine = await seedPair(t, { ageMs: OLD })
    fake.balance.set(short.reader, BigInt(15_000_000))
    fake.expiredKeys.add(`${expired.reader}|0`)
    fake.paid.set(`${stale.reader}|0|${stale.writer}`, stale.cumulative)
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r.status).toBe('confirmed')
    const [s] = await settlements(t)
    expect(s).toMatchObject({ settled: 2, skipped: 2 })

    // Paid 1.5 XLM of 2: receipt 1 settled, receipt 2 short.
    expect(await voucher(t, short.voucherId)).toMatchObject({
      paidOnChain: '15000000',
      settleQueue: 'ready',
      unsettled: true,
    })
    expect(await receipts(t, short)).toEqual(['SETTLED', 'SHORTFALL'])
    expect(await voucher(t, expired.voucherId)).toMatchObject({
      state: 'UNPAID',
      lastSkipReason: 'KEY_EXPIRED',
      settleQueue: 'done',
    })
    expect(await receipts(t, expired)).toEqual(['UNPAID'])
    // Paid on chain by another path (settle_own): at least the cumulative.
    expect(await voucher(t, stale.voucherId)).toMatchObject({
      lastSkipReason: 'STALE',
      paidOnChain: stale.cumulative.toString(),
      settleQueue: 'done',
    })
    expect(await receipts(t, stale)).toEqual(['SETTLED'])
    expect((await voucher(t, fine.voucherId)).settleQueue).toBe('done')

    // Next run: the balance is now 0, so the pair is skipped and parked.
    const next = await runSettlementCycle(depsFor(t, fake))
    expect(next.status).toBe('confirmed')
    expect(await voucher(t, short.voucherId)).toMatchObject({
      lastSkipReason: 'SHORTFALL',
      settleQueue: 'blocked',
    })
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe(
      'nothing_due'
    )
    // A deposit returns it to the queue, and the rest settles.
    fake.balance.set(short.reader, XLM)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        {
          type: 'contract',
          ledger: LEDGER + 10,
          ledgerClosedAt: new Date(T0).toISOString(),
          contractId: TAB,
          id: rpcEventId(LEDGER + 10, 1, 0, 0),
          txHash: 'ee'.repeat(32),
          topic: [
            xdr.ScVal.scvSymbol('deposited').toXdr('base64'),
            new Address(short.reader).toScVal().toXdr('base64'),
          ],
          value: mapOf([
            ['amount', i128(XLM)],
            ['balance_after', i128(XLM)],
          ]).toXdr('base64'),
          inSuccessfulContractCall: true,
        },
      ],
    })
    expect((await voucher(t, short.voucherId)).settleQueue).toBe('ready')
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe(
      'confirmed'
    )
    expect(await receipts(t, short)).toEqual(['SETTLED', 'SETTLED'])
  })
})

describe('recovery', () => {
  it('resumes after a crash between sending and recording the result: no lost and no double settlement', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const p = await seedPair(t, { ageMs: OLD })
    fake.pendingLookups = 10
    const first = await runSettlementCycle(depsFor(t, fake))
    expect(first.status).toBe('pending')
    expect(await voucher(t, p.voucherId)).toMatchObject({
      settleQueue: 'inflight',
      paidOnChain: '0',
    })
    // The pair is not selected again while its settlement is open.
    fake.pendingLookups = 1
    const second = await runSettlementCycle(depsFor(t, fake))
    expect(second.status).toBe('pending')
    expect(fake.calls.prepare).toBe(1)
    const third = await runSettlementCycle(depsFor(t, fake))
    expect(third).toMatchObject({ status: 'nothing_due', resumed: 1 })
    expect(fake.calls.prepare).toBe(1)
    expect((await settlements(t))[0]).toMatchObject({ status: 'CONFIRMED' })
    expect(await voucher(t, p.voucherId)).toMatchObject({
      paidOnChain: p.cumulative.toString(),
      settleQueue: 'done',
    })
  })

  it('re-sends the recorded envelope when the send did not go through', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const p = await seedPair(t, { ageMs: OLD })
    fake.sendTransient = 1
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe('pending')
    expect((await settlements(t))[0]).toMatchObject({
      status: 'SUBMITTED',
      attempts: 1,
      lastError: 'TRY_AGAIN_LATER',
    })
    // Next run: not found, still inside its time bounds, so the same envelope is sent.
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe('pending')
    expect(fake.calls.prepare).toBe(1)
    expect(fake.calls.send).toBe(2)
    expect((await runSettlementCycle(depsFor(t, fake))).resumed).toBe(1)
    expect((await voucher(t, p.voucherId)).paidOnChain).toBe(
      p.cumulative.toString()
    )
    expect(fake.txs.size).toBe(1)
  })

  it('fails a settlement that crashed before its envelope was recorded, and settles again', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const p = await seedPair(t, { ageMs: OLD })
    fake.prepareThrows = true
    await expect(runSettlementCycle(depsFor(t, fake))).rejects.toThrow(
      'process stopped'
    )
    expect((await settlements(t))[0]!.status).toBe('PREPARED')
    fake.prepareThrows = false
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r).toMatchObject({ status: 'confirmed', resumed: 1 })
    const rows = await settlements(t)
    expect(rows.map((s) => [s.status, s.lastError ?? null])).toEqual([
      ['FAILED', 'not_sent'],
      ['CONFIRMED', null],
    ])
    expect((await voucher(t, p.voucherId)).paidOnChain).toBe(
      p.cumulative.toString()
    )
    expect([...fake.txs.values()].filter((x) => x.included)).toHaveLength(1)
  })

  it('expires a recorded transaction that never landed, then settles the pair again', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const p = await seedPair(t, { ageMs: OLD })
    fake.sendTransient = 1
    await runSettlementCycle(depsFor(t, fake))
    // Its time bound passes on chain without inclusion.
    fake.closeTime += 400
    fake.ledger += 80
    const r = await runSettlementCycle(depsFor(t, fake))
    expect(r).toMatchObject({ status: 'confirmed', resumed: 1 })
    expect((await settlements(t)).map((s) => s.status)).toEqual([
      'EXPIRED',
      'CONFIRMED',
    ])
    expect((await voucher(t, p.voucherId)).paidOnChain).toBe(
      p.cumulative.toString()
    )
  })

  it('retries after RPC failures in lookup and simulation', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const p = await seedPair(t, { ageMs: OLD })
    fake.simulateTransient = 1
    const deps = depsFor(t, fake)
    await expect(runSettlementCycle(deps)).rejects.toThrow('RPC 503')
    expect(deps.logs.map((l) => l.code)).toContain('TAB_SETTLER_RUN_FAILED')
    expect(await settlements(t)).toHaveLength(0)
    expect((await voucher(t, p.voucherId)).settleQueue).toBe('ready')

    // Both lookups after sending fail; the next run finds the result.
    fake.lookupThrows = 2
    expect((await runSettlementCycle(depsFor(t, fake))).status).toBe('pending')
    expect((await settlements(t))[0]!.attempts).toBe(2)
    expect((await runSettlementCycle(depsFor(t, fake))).resumed).toBe(1)
    expect((await voucher(t, p.voucherId)).paidOnChain).toBe(
      p.cumulative.toString()
    )
  })
})

describe('key windows and starvation', () => {
  it('moves pairs past their window to UNPAID, also for open tabs, and alerts before the end', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const gone = await seedPair(t, { windowLedgers: -1 })
    const soon = await seedPair(t, {
      windowLedgers: DAY_LEDGERS,
      amounts: [BigInt(2) * XLM],
    })
    const deps = depsFor(t, fake)
    const r = await runSettlementCycle(deps)
    expect(r).toMatchObject({ swept: 1, status: 'confirmed', submitted: 1 })
    expect(await voucher(t, gone.voucherId)).toMatchObject({
      state: 'UNPAID',
      settleQueue: 'done',
      pendingNet: '0',
    })
    expect(await receipts(t, gone)).toEqual(['UNPAID'])
    const account = await run(t, async (ctx) => ctx.db.get(gone.accountId))
    expect(account).toMatchObject({ status: 'OPEN', outstanding: '0' })
    expect(deps.logs).toContainEqual({
      code: 'TAB_SETTLER_KEY_EXPIRING',
      count: 1,
      amount: (BigInt(2) * XLM).toString(),
    })
    expect((await voucher(t, soon.voucherId)).paidOnChain).toBe(
      (BigInt(2) * XLM).toString()
    )
  })

  it('closes nothing as UNPAID until the indexer has passed the window end', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    const gone = await seedPair(t, { windowLedgers: -1 })
    // The chain is past the window, but the indexer is behind it: a settlement
    // in the window's last ledgers may not be applied yet.
    await indexedThrough(t, LEDGER - 10)
    const lagging = depsFor(t, fake, {
      latestLedger: async () => ({
        sequence: fake.ledger,
        closeTime: fake.closeTime,
      }),
    })
    expect(await runSettlementCycle(lagging)).toMatchObject({ swept: 0 })
    expect((await voucher(t, gone.voucherId)).state).toBe('ACTIVE')
    await indexedThrough(t, fake.ledger)
    expect(await runSettlementCycle(lagging)).toMatchObject({ swept: 1 })
    expect((await voucher(t, gone.voucherId)).state).toBe('UNPAID')
  })

  it('a revoked key shortens the window', async () => {
    const t = convexTest(schema, modules)
    const p = await seedPair(t)
    await t.mutation(internal.chain.indexer.ingestBackfill, {
      events: [
        {
          type: 'contract',
          ledger: LEDGER,
          ledgerClosedAt: new Date(T0).toISOString(),
          contractId: TAB,
          id: rpcEventId(LEDGER, 1, 0, 0),
          txHash: 'ef'.repeat(32),
          topic: [
            xdr.ScVal.scvSymbol('key_revoked').toXdr('base64'),
            new Address(p.reader).toScVal().toXdr('base64'),
          ],
          value: mapOf([
            ['key_id', u32(0)],
            ['valid_until', u32(LEDGER)],
          ]).toXdr('base64'),
          inSuccessfulContractCall: true,
        },
      ],
    })
    expect((await voucher(t, p.voucherId)).settleBy).toBe(
      LEDGER + SETTLE_GRACE_LEDGERS
    )
  })

  it('pairs that cannot settle do not starve due pairs', async () => {
    const t = convexTest(schema, modules)
    const fake = new FakeTab()
    // 320 parked (SHORTFALL) pairs with the oldest receipts and soonest windows,
    // and 250 expired pairs: more than one selection scan and one sweep call.
    for (let i = 0; i < 320; i++) {
      await seedPair(t, {
        queue: 'blocked',
        ageMs: OLD * 2,
        windowLedgers: 3 * DAY_LEDGERS,
      })
    }
    for (let i = 0; i < 250; i++) {
      await seedPair(t, { ageMs: OLD * 2, windowLedgers: -5 })
    }
    const due = await seedPair(t, {
      ageMs: OLD,
      windowLedgers: 25 * DAY_LEDGERS,
    })
    let r = await runSettlementCycle(depsFor(t, fake))
    // The first run sweeps up to the sweep limit; any run settles the due pair.
    for (let i = 0; i < 3 && r.status !== 'confirmed'; i++) {
      r = await runSettlementCycle(depsFor(t, fake))
    }
    expect(r.status).toBe('confirmed')
    expect((await voucher(t, due.voucherId)).paidOnChain).toBe(
      due.cumulative.toString()
    )
    const unpaid = await run(
      t,
      async (ctx) =>
        (await ctx.db.query('tabVouchers').collect()).filter(
          (v) => v.state === 'UNPAID'
        ).length
    )
    expect(unpaid).toBe(250)
  })
})

describe('guard and configuration', () => {
  it('does nothing unless SETTLEMENT_ENABLED and TAB_CONTRACT_ID are set, and never reads the key first', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('TAB_SETTLER_SECRET', 'not-a-secret')
    vi.stubEnv('SETTLEMENT_ENABLED', '')
    expect(await t.action(internal.tabSettler.settleDue, {})).toEqual({
      status: 'disabled',
      reason: 'SETTLEMENT_ENABLED is not true',
    })
    vi.stubEnv('SETTLEMENT_ENABLED', 'true')
    vi.stubEnv('TAB_CONTRACT_ID', '')
    expect(await t.action(internal.tabSettler.settleDue, {})).toMatchObject({
      status: 'disabled',
    })
    vi.stubEnv('TAB_CONTRACT_ID', TAB)
    await expect(t.action(internal.tabSettler.settleDue, {})).rejects.toThrow(
      /TAB_SETTLER_SECRET/
    )
  })

  it('refuses a mainnet configuration before reading the settler key', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('TAB_SETTLER_SECRET', 'not-a-secret')
    vi.stubEnv('STELLAR_NETWORK', 'PUBLIC')
    const error = await t
      .action(internal.tabSettler.settleDue, {})
      .catch((e) => e)
    expect(String(error)).not.toMatch(/TAB_SETTLER_SECRET/)
    expect(String(error)).toMatch(/network|TESTNET|mainnet|PUBLIC/i)
    vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv(
      'NETWORK_PASSPHRASE',
      'Public Global Stellar Network ; September 2015'
    )
    expect(() => settlerConfig()).toThrow()
  })

  it('stores the Tab acceptor keys from the config refresh', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv(
      'CORE_CONTRACT_ID',
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOLZM'
    )
    const keys = [shared.keys.acceptor.public_key, 'ab'.repeat(32)]
    const fetch = fakeRpcFetch((method, params) => {
      if (method !== 'simulateTransaction') throw new Error(method)
      // The invoked function name is the only symbol of this length in the envelope.
      const bytes = Buffer.from(
        (params as { transaction: string }).transaction,
        'base64'
      )
      const fn = ['config', 'paused', 'fee_bps', 'min_tip', 'threshold'].find(
        (name) => bytes.includes(Buffer.from(name))
      )
      const retval =
        fn === 'config'
          ? mapOf([
              [
                'acceptor_keys',
                xdr.ScVal.scvVec(
                  keys.map((k) => xdr.ScVal.scvBytes(Buffer.from(k, 'hex')))
                ),
              ],
              ['max_balance', i128(BigInt(10_000) * XLM)],
              ['min_deposit', i128(XLM)],
              ['token', new Address(TOKEN).toScVal()],
              ['treasury', new Address(SETTLER.publicKey()).toScVal()],
            ])
          : fn === 'paused'
            ? xdr.ScVal.scvBool(false)
            : fn === 'fee_bps'
              ? u32(250)
              : i128(BigInt(1_000_000))
      return {
        latestLedger: LEDGER,
        results: [{ xdr: retval.toXdr('base64') }],
      }
    })
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('TAB_ACCEPTOR_SECRET', shared.keys.acceptor.seed)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await t.action(internal.chain.config.refreshChainConfig, {})
    const config = await run(t, async (ctx) =>
      ctx.db.query('chainConfig').first()
    )
    expect(config!.lastError ?? null).toBe(null)
    expect(config!.tabAcceptorKeys).toEqual(keys)
    expect(errors.mock.calls.flat().join('')).not.toContain(
      'TAB_ACCEPTOR_MISMATCH'
    )
    // A deployment whose acceptor key the Tab does not list is reported.
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'ef'.repeat(32))
    await t.action(internal.chain.config.refreshChainConfig, {})
    expect(errors.mock.calls.flat().join('')).toContain('TAB_ACCEPTOR_MISMATCH')
  })
})
