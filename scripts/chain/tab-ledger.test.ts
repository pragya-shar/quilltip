/// <reference types="vite/client" />
/**
 * Tab ledger and voucher acceptance (#447). The reader, writer, keys, tab
 * contract, network and receipts come from `contracts/shared/test-vectors.json`,
 * so a full three-tip sequence must reproduce the Rust voucher payload,
 * receipts root and acceptance signature byte for byte (I-23). Fixtures:
 * `tab-kit.ts`.
 */
import { convexTest } from 'convex-test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'buffer'
import { Address, xdr } from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'
import { api, internal } from '../../convex/_generated/api'
import type { Doc, Id, TableNames } from '../../convex/_generated/dataModel'
import {
  DAY_LEDGERS,
  SETTLE_GRACE_LEDGERS,
  netOf,
  receiptPaidNet,
} from '../../convex/lib/chain/tabLedger'
import {
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  verifyEd25519,
  voucherPayloadBytes,
  acceptancePayloadBytes,
} from '../../convex/lib/chain/voucher'
import { hexToBytes, bytesToHex } from '../../convex/lib/chain/ids'
import { formatUsd, formatXlmFromStroops } from '../../lib/copy/network-status'
import { applyV2TipEarnings } from '../../convex/lib/v2Earnings'
import { AGGREGATE_LIMIT } from '../../convex/lib/tipReads'
import {
  creditAuthorEarnings,
  roundCents,
  tabShareCents,
  writerShareCents,
} from '../../convex/lib/authorEarnings'
import {
  creditTabTipTotals,
  creditV1TipTotals,
} from '../../convex/lib/lifetimeEarnings'
import { checkTabTipAmount, tabTipLimitsAt } from '../../lib/tab-ui/tip-limits'
import { signEd25519 } from '../../lib/stellar/v2/tab/encoding'
import { commitAcceptedTip, signTabTip } from '../../lib/stellar/v2/tab'
import { depsFor, freshDb, plantKey } from '../tab/helpers'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { seedAddress } from './fixtures'
import {
  ACCEPTOR_PUBLIC,
  CLIENT_SCOPE,
  EPOCH,
  HIGHLIGHT,
  LEDGER,
  OTHER_WRITER,
  PASSPHRASE,
  READER,
  SESSION_PUBLIC,
  SESSION_SEED,
  T0,
  TAB,
  TOKEN,
  VALID_UNTIL,
  VECTOR_RECEIPTS,
  WRITER,
  XLM,
  account,
  as,
  bytes,
  earnings,
  errorCode,
  ev,
  eventId,
  i128,
  ingest,
  modules,
  prepare,
  receiptStatuses,
  seed,
  setLedger,
  sign,
  submit,
  tabEvent,
  tip,
  u32,
  withTabEnv,
  useVectorClientRefs,
  voucherRow,
  type Prepared,
  type ScEntry,
  type Seeded,
  type T,
} from './tab-kit'

import { expectRedispatchChangesNothing } from './redispatch'

withTabEnv()

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

describe('writer earnings summary with tab tips (#552)', () => {
  beforeEach(() => {
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'true')
  })
  // $1 per XLM in the seed: 10 cents is 1,000,000 stroops.
  const rawSummary = (t: T, userId: Id<'users'>) =>
    as(t, userId).query(api.tips.getMyEarningsSummary, {})
  /**
   * The figures the stats cards show: `lifetime` once the row is rebuilt,
   * the fields as computed before #552 until then.
   */
  async function summaryOf(t: T, userId: Id<'users'>) {
    const r = await rawSummary(t, userId)
    if (!r) return r
    return r.lifetime
      ? { ...r, ...r.lifetime, complete: true, source: 'lifetime' as const }
      : { ...r, source: 'previous' as const }
  }
  const summary = (t: T, s: Seeded) => summaryOf(t, s.authorId)

  /** `n` tips of 10 cents and 0.1 XLM: what all three figures must read. */
  const lifetime = (n: number) => ({
    tipCount: n,
    earnedStroops: (BigInt(n) * BigInt(975_000)).toString(),
    estimatedUsd: (n * 9.75) / 100,
    complete: true,
    updating: false,
    source: 'lifetime',
  })

  /** `n` confirmed v2 wallet tips of 0.1 XLM, credited by the earnings sync. */
  async function walletRows(
    t: T,
    s: Seeded,
    n: number,
    table: 'tips' | 'highlightTips' = 'tips'
  ) {
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i += 1) {
        const now = Date.now()
        const row = {
          articleId: s.articleId,
          tipperId: s.readerId,
          authorId: s.authorId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.1,
          amountCents: 10,
          status: 'CONFIRMED',
          contractVersion: 'v2' as const,
          channel: 'direct' as const,
          tokenContractId: TOKEN,
          onChainTokenContractId: TOKEN,
          grossBaseUnits: '1000000',
          netBaseUnits: '975000',
          onChainAuthorAddress: WRITER,
          expectedAuthorAddress: WRITER,
          chainEpoch: EPOCH,
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        }
        const id =
          table === 'tips'
            ? await ctx.db.insert('tips', row)
            : await ctx.db.insert('highlightTips', {
                ...row,
                highlightId: `w${i}`,
                highlightText: 'words',
                startOffset: 0,
                endOffset: 5,
              })
        expect(await applyV2TipEarnings(ctx, table, id, now)).toBe('credited')
      }
    })
  }

  /**
   * `n` confirmed wallet tips of 0.1 XLM, fast: the first through the earnings
   * sync, the rest inserted as the sync leaves them and credited in one patch
   * with the same amounts. `walletRows` credits each row for real.
   */
  async function walletRowsBulk(
    t: T,
    s: Seeded,
    n: number,
    table: 'tips' | 'highlightTips' = 'tips'
  ) {
    await walletRows(t, s, 1, table)
    await t.run(async (ctx) => {
      const now = Date.now()
      for (let i = 1; i < n; i += 1) {
        const row = {
          articleId: s.articleId,
          tipperId: s.readerId,
          authorId: s.authorId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.1,
          amountCents: 10,
          status: 'CONFIRMED',
          contractVersion: 'v2' as const,
          channel: 'direct' as const,
          tokenContractId: TOKEN,
          onChainTokenContractId: TOKEN,
          grossBaseUnits: '1000000',
          netBaseUnits: '975000',
          onChainAuthorAddress: WRITER,
          expectedAuthorAddress: WRITER,
          chainEpoch: EPOCH,
          verifiedAt: now,
          earningsAppliedAt: now,
          createdAt: now,
          updatedAt: now,
        }
        if (table === 'tips') await ctx.db.insert('tips', row)
        else {
          await ctx.db.insert('highlightTips', {
            ...row,
            highlightId: `b${i}`,
            highlightText: 'words',
            startOffset: 0,
            endOffset: 5,
          })
        }
      }
      const earnings = (await ctx.db.query('authorEarnings').collect()).find(
        (r) => r.userId === s.authorId
      )!
      const add = (units: Record<string, string> | undefined) => ({
        ...units,
        [TOKEN]: (
          BigInt(units?.[TOKEN] ?? '0') +
          BigInt(975_000) * BigInt(n - 1)
        ).toString(),
      })
      await ctx.db.patch(earnings._id, {
        earnedBaseUnits: add(earnings.earnedBaseUnits),
        walletEarnedBaseUnits: add(earnings.walletEarnedBaseUnits),
        v2EarnedCents: (earnings.v2EarnedCents ?? 0) + 9.75 * (n - 1),
        v2TipCount: (earnings.v2TipCount ?? 0) + (n - 1),
        tipCount: earnings.tipCount + (n - 1),
        totalEarnedCents: earnings.totalEarnedCents + 9.75 * (n - 1),
      })
    })
  }

  /**
   * `n` verified v1 tips of 10 cents and 0.1 XLM, fast: inserted, with the
   * user's earnings row created by one v1 credit (rows from before this
   * change, as the rebuild finds them).
   */
  async function v1RowsBulk(
    t: T,
    userId: Id<'users'>,
    articleId: Id<'articles'>,
    n: number
  ) {
    await t.run(async (ctx) => {
      const now = Date.now()
      for (let i = 0; i < n; i += 1) {
        await ctx.db.insert('tips', {
          articleId,
          tipperId: userId,
          authorId: userId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.1,
          amountCents: 10,
          expectedAmountStroops: '1000000',
          status: 'CONFIRMED',
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        })
      }
      await creditAuthorEarnings(ctx, {
        authorId: userId,
        articleId,
        articleTitle: 'Words',
        shareCents: writerShareCents(10, '1000000'),
        now,
      })
    })
  }

  /** `n` verified v1 tips of 10 cents and 0.1 XLM, credited as v1 was. */
  async function v1Rows(
    t: T,
    userId: Id<'users'>,
    articleId: Id<'articles'>,
    n: number
  ) {
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i += 1) {
        const now = Date.now()
        await ctx.db.insert('tips', {
          articleId,
          tipperId: userId,
          authorId: userId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.1,
          amountCents: 10,
          expectedAmountStroops: '1000000',
          status: 'CONFIRMED',
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        await creditAuthorEarnings(ctx, {
          authorId: userId,
          articleId,
          articleTitle: 'Words',
          shareCents: writerShareCents(10, '1000000'),
          now,
        })
      }
    })
  }

  const settleAll = (t: T, gross: bigint, writer = WRITER) =>
    ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross, writer })
    )

  async function tabRowIndex(
    t: T,
    s: Seeded,
    table: 'tips' | 'highlightTips' = 'tips'
  ) {
    return t.run(async (ctx) =>
      (await ctx.db.query(table).collect())
        .filter((r) => r.authorId === s.authorId)
        .flatMap((row, i) => (row.channel === 'tab' ? [i] : []))
    )
  }

  const earningsRow = (t: T, userId: Id<'users'>) =>
    t.run(
      async (ctx) =>
        (await ctx.db.query('authorEarnings').collect()).find(
          (r) => r.userId === userId
        ) ?? null
    )

  /** The row as it was before this change: no lifetime totals. */
  async function forgetTotals(t: T, userId: Id<'users'>) {
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
        lifetimeRebuild: undefined,
        lifetimeRebuildTurnAt: undefined,
      })
    })
  }

  const rebuildRun = (t: T) => t.action(internal.earningsTotalsBackfill.run, {})
  async function rebuildAll(t: T) {
    for (let i = 0; i < 100; i += 1) {
      const pending = await t.query(
        internal.earningsTotalsBackfill.pendingRows,
        { limit: 1 }
      )
      if (pending.length === 0) return
      await rebuildRun(t)
    }
    throw new Error('the rebuild did not finish')
  }

  /**
   * The live totals equal the totals rebuilt from history: forget them, read
   * the history (when it fits in one read), rebuild, and compare.
   */
  async function liveEqualsHistory(t: T, userId: Id<'users'>) {
    const live = (await summaryOf(t, userId))!
    expect(live.source).toBe('lifetime')
    await forgetTotals(t, userId)
    // Not rebuilt: the previous figures.
    expect(await summaryOf(t, userId)).toMatchObject({ source: 'previous' })
    await rebuildAll(t)
    expect((await earningsRow(t, userId))?.lifetimeTotalsAt).toBeTypeOf(
      'number'
    )
    expect(await summaryOf(t, userId)).toEqual(live)
    return live
  }

  it('a tab tip accepted but not settled is in none of the figures', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    // Accepting credits only the pending amount.
    const row = await earningsRow(t, s.authorId)
    expect(row?.pendingBaseUnits?.[TOKEN]).toBe(
      netOf(BigInt(1_000_000)).toString()
    )
    expect(row?.lifetimeTotalsAt).toBeTypeOf('number')
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(0))
  })

  it('settled tab tips only: XLM, USD and count cover the same tips', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await settleAll(t, BigInt(3_500_000))
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject({
      tipCount: 2,
      // 97.5 % of 3.5 XLM, under the cumulative fee rule.
      earnedStroops: netOf(BigInt(3_500_000)).toString(),
      // 97.5 % of 35 cents.
      estimatedUsd: 0.34125,
      complete: true,
    })
  })

  it('a short settlement counts the net paid on chain, the partly paid tip included', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    // 1.5 of 3.5 XLM paid: receipt 1 settles, receipt 2 waits (SHORTFALL).
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SHORTFALL'])
    // The tab total is the pair's paid net: all of receipt 1 and the paid
    // part of receipt 2 (0.5 of 2.5 XLM), with the tips' quoted cents in
    // proportion: 9.75 + 25 × 0.195.
    const row = await earningsRow(t, s.authorId)
    expect(row?.earnedBaseUnits?.[TOKEN]).toBe(
      netOf(BigInt(1_500_000)).toString()
    )
    expect(row?.tabSettledBaseUnits?.[TOKEN]).toBe(
      netOf(BigInt(1_500_000)).toString()
    )
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject({
      tipCount: 2,
      earnedStroops: '1462500',
      estimatedUsd: 0.14625,
    })
  })

  it('wallet and tab tips together: the integration writer reads 114.58 XLM, $14.87 and 9 tips', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Three tab tips of 50, 50 and 25 cents, settled on chain.
    await tip(t, s, { cents: 50 })
    await tip(t, s, { cents: 50 })
    await tip(t, s, { cents: 25 })
    await settleAll(t, BigInt(12_500_000))
    const tabNet = netOf(BigInt(12_500_000))
    // Six confirmed wallet tips, as the earnings sync credits them: the
    // integration row has 1,145,760,615 base units in all and 1,365 cents.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('authorEarnings').collect()).find(
        (r) => r.userId === s.authorId
      )!
      // The tab settlement credited the display totals and the tab totals.
      expect(row).toMatchObject({
        tipCount: 3,
        totalEarnedCents: 121.875,
        tabTipCount: 3,
        tabEarnedCents: 121.875,
        tabSettledBaseUnits: { [TOKEN]: tabNet.toString() },
        earnedBaseUnits: { [TOKEN]: tabNet.toString() },
      })
      await ctx.db.patch(row._id, {
        earnedBaseUnits: { [TOKEN]: '1145760615' },
        walletEarnedBaseUnits: {
          [TOKEN]: (BigInt('1145760615') - tabNet).toString(),
        },
        v2EarnedCents: 1365,
        v2TipCount: 6,
        totalEarnedCents: 1486.875,
        tipCount: 9,
      })
    })
    const result = await liveEqualsHistory(t, s.authorId)
    expect(result).toMatchObject({
      tipCount: 9,
      earnedStroops: '1145760615',
      estimatedUsd: 14.86875,
      unpricedTipCount: 0,
      complete: true,
    })
    // As the stats page shows them.
    expect(formatXlmFromStroops(result.earnedStroops, 2)).toBe('114.58 XLM')
    expect(formatUsd(result.estimatedUsd)).toBe('$14.87')
  })

  it('a settled tab tip after more than one read of wallet rows is in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRows(t, s, AGGREGATE_LIMIT + 1)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    expect(await receiptStatuses(t)).toEqual(['SETTLED'])
    expect((await tabRowIndex(t, s))[0]).toBe(AGGREGATE_LIMIT + 1)
    expect(await summary(t, s)).toEqual(
      expect.objectContaining(lifetime(AGGREGATE_LIMIT + 2))
    )
    await liveEqualsHistory(t, s.authorId)
  }, 120_000)

  it('a settled tab tip before more than one read of wallet rows is in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await walletRowsBulk(t, s, AGGREGATE_LIMIT + 1)
    await settleAll(t, BigInt(1_000_000))
    expect((await tabRowIndex(t, s))[0]).toBe(0)
    expect(await summary(t, s)).toMatchObject(lifetime(AGGREGATE_LIMIT + 2))
  }, 120_000)

  it('settled tab tips on both sides of one read are all in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await walletRowsBulk(t, s, AGGREGATE_LIMIT)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(2_000_000))
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    expect(await tabRowIndex(t, s)).toEqual([0, AGGREGATE_LIMIT + 1])
    expect(await summary(t, s)).toMatchObject(lifetime(AGGREGATE_LIMIT + 2))
  }, 120_000)

  it('a settled passage tab tip after more than one read of passage wallet rows is in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRowsBulk(t, s, AGGREGATE_LIMIT + 1, 'highlightTips')
    await tip(t, s, { cents: 10, highlight: HIGHLIGHT })
    await settleAll(t, BigInt(1_000_000))
    expect((await tabRowIndex(t, s, 'highlightTips'))[0]).toBe(
      AGGREGATE_LIMIT + 1
    )
    expect(await summary(t, s)).toMatchObject(lifetime(AGGREGATE_LIMIT + 2))
    await liveEqualsHistory(t, s.authorId)
  }, 120_000)

  it('an accepted, unsettled tab tip after one read is in none of the figures', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRowsBulk(t, s, AGGREGATE_LIMIT + 1)
    await tip(t, s, { cents: 10 })
    expect(await receiptStatuses(t)).toEqual(['ACCEPTED'])
    expect(await summary(t, s)).toMatchObject(lifetime(AGGREGATE_LIMIT + 1))
  }, 120_000)

  it('wallet tips only', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRows(t, s, 2)
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(2))
  })

  it('v1, wallet and settled tab tips are all in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1Rows(t, s.authorId, s.articleId, 3)
    await walletRows(t, s, 2)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    // The row was created with v1 rows behind it: until the rebuild, the
    // previous figures (the tab tip in the XLM only, as before).
    expect((await earningsRow(t, s.authorId))?.lifetimeTotalsAt).toBeUndefined()
    expect(await summary(t, s)).toMatchObject({
      tipCount: 5,
      earnedStroops: (BigInt(6) * BigInt(975_000)).toString(),
      estimatedUsd: 0.4875,
      source: 'previous',
      updating: false,
    })
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(6))
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(6))
  })

  it('more v1 rows than one read: the previous figures until the rebuild, then every tip', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1RowsBulk(t, s.authorId, s.articleId, AGGREGATE_LIMIT + 1)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    // The previous figures read 2,000 v1 rows: a lower bound, said so.
    expect(await summary(t, s)).toMatchObject({
      tipCount: AGGREGATE_LIMIT,
      complete: false,
      updating: false,
      source: 'previous',
    })
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(AGGREGATE_LIMIT + 2))
  }, 120_000)

  it('a writer without an earnings row: v1 rows beyond one read are a lower bound in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await t.run(async (ctx) => {
      for (let i = 0; i <= AGGREGATE_LIMIT; i += 1) {
        const now = Date.now()
        await ctx.db.insert('tips', {
          articleId: s.articleId,
          tipperId: s.readerId,
          authorId: s.authorId,
          articleTitle: 'Words',
          articleSlug: 'words',
          amountUsd: 0.1,
          amountCents: 10,
          expectedAmountStroops: '1000000',
          status: 'CONFIRMED',
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        })
      }
    })
    expect(await earningsRow(t, s.authorId)).toBeNull()
    expect(await summary(t, s)).toMatchObject({
      ...lifetime(AGGREGATE_LIMIT),
      complete: false,
      updating: false,
      source: 'previous',
    })
  }, 120_000)

  it('a co-author split: each writer reads their share, the co-author without rows of their own', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // The other article: OTHER_WRITER first, this writer second, 50/50.
    await t.run(async (ctx) => {
      const chain = (await ctx.db.query('chainArticles').collect()).find(
        (a) => a.articleId === s.otherArticleId
      )!
      await ctx.db.patch(chain._id, {
        splits: [
          { recipient: OTHER_WRITER, bps: 5000 },
          { recipient: WRITER, bps: 5000 },
        ],
      })
      const now = Date.now()
      const id = await ctx.db.insert('tips', {
        articleId: s.otherArticleId,
        tipperId: s.readerId,
        authorId: s.otherAuthorId,
        articleTitle: 'Other',
        articleSlug: 'other-article',
        amountUsd: 0.1,
        amountCents: 10,
        status: 'CONFIRMED',
        contractVersion: 'v2',
        channel: 'direct',
        tokenContractId: TOKEN,
        onChainTokenContractId: TOKEN,
        grossBaseUnits: '1000000',
        netBaseUnits: '975000',
        onChainAuthorAddress: OTHER_WRITER,
        expectedAuthorAddress: OTHER_WRITER,
        chainArticleKey: 'cd'.repeat(32),
        chainEpoch: EPOCH,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      expect(await applyV2TipEarnings(ctx, 'tips', id, now)).toBe('credited')
    })
    const share = {
      tipCount: 1,
      earnedStroops: '487500',
      estimatedUsd: 0.04875,
      complete: true,
    }
    // This writer is the co-author: the row is under the main author's id.
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(share)
    expect(await liveEqualsHistory(t, s.otherAuthorId)).toMatchObject(share)
  })

  it("a settled tip whose pair is past one read of the writer's pairs is counted once", async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // The writer already has one read's worth of other pairs, nothing earned.
    await t.run(async (ctx) => {
      const account = (await ctx.db.query('tabAccounts').first())!
      const now = Date.now()
      for (let i = 0; i < AGGREGATE_LIMIT; i += 1) {
        await ctx.db.insert('tabVouchers', {
          network: 'TESTNET',
          chainEpoch: EPOCH,
          tabAccountId: account._id,
          tabContractId: TAB,
          tokenContractId: TOKEN,
          readerAddress: READER,
          keyId: 1000 + i,
          writerAddress: WRITER,
          authorId: s.authorId,
          cumulative: '0',
          receiptsRoot: '00'.repeat(32),
          leafHashes: [],
          signature: '00'.repeat(64),
          acceptance: { acceptor: ACCEPTOR_PUBLIC, signature: '00'.repeat(64) },
          seq: 0,
          paidOnChain: '0',
          unsettled: false,
          state: 'UNPAID',
          settleQueue: 'done',
          earnedNet: '0',
          pendingNet: '0',
          acceptedAt: now,
          updatedAt: now,
        })
      }
    })
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    expect(await receiptStatuses(t)).toEqual(['SETTLED'])
    expect(await summary(t, s)).toMatchObject(lifetime(1))
    await liveEqualsHistory(t, s.authorId)
  }, 120_000)

  it('a writer who changed addresses keeps the tab tips of both', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    const NEW_WRITER = seedAddress(42)
    await t.run(async (ctx) => {
      await ctx.db.patch(s.authorId, { stellarAddress: NEW_WRITER })
      await ctx.db.patch(s.chainArticleId, { authorAddress: NEW_WRITER })
    })
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000), NEW_WRITER)
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(2))
  })

  it('a legacy v1 tip without a trusted USD amount keeps its XLM and its place in the count', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('highlightTips', {
        highlightId: 'legacy',
        highlightText: 'legacy passage',
        startOffset: 0,
        endOffset: 14,
        articleId: s.articleId,
        tipperId: s.readerId,
        authorId: s.authorId,
        articleTitle: 'Words',
        articleSlug: 'words',
        amountUsd: 0,
        amountCents: 0,
        amountUsdSuspicious: true,
        status: 'CONFIRMED',
        contractVersion: 'v1',
        expectedAmountStroops: '1000000',
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      await creditAuthorEarnings(ctx, {
        authorId: s.authorId,
        articleId: s.articleId,
        articleTitle: 'Words',
        shareCents: 0,
        now,
      })
    })
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject({
      tipCount: 1,
      earnedStroops: '975000',
      // No dollars for it: the USD figure is a lower bound.
      estimatedUsd: 0,
      unpricedTipCount: 1,
      complete: true,
    })
  })

  it('a long rebuild resumes from its stored cursor, not from the first page', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await v1Rows(t, s.authorId, s.articleId, 450)
    const row = (await earningsRow(t, s.authorId))!
    // One step, then the action stops (an interrupted run or a restart).
    expect(
      await t.mutation(internal.earningsTotalsBackfill.rebuildStep, {
        id: row._id,
      })
    ).toBe('more')
    const progress = (await earningsRow(t, s.authorId))!.lifetimeRebuild!
    expect(progress).toMatchObject({ phase: 'tips', steps: 1 })
    expect(progress.cursor).toBeTypeOf('string')
    expect(progress.totals.v1TipCount).toBe(200)
    // Mid-rebuild the summary says so, with the previous figures.
    expect(await summary(t, s)).toMatchObject({
      ...lifetime(450),
      updating: true,
      source: 'previous',
    })
    // Probe: change a row of the first page behind the rebuild's back. A
    // rebuild that started again would read the new amount.
    await t.run(async (ctx) => {
      const first = (await ctx.db.query('tips').collect()).find(
        (r) => r.authorId === s.authorId
      )!
      await ctx.db.patch(first._id, { amountCents: 1_000 })
    })
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(450))
  }, 60_000)

  it('a writer who keeps receiving tips during a rebuild holds up no one, and every tip counts once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // A long writer: one pending v1 tip first, then 2,100 verified v1 tips.
    const pendingId = await t.run(async (ctx) => {
      const now = Date.now()
      return ctx.db.insert('tips', {
        articleId: s.articleId,
        tipperId: s.readerId,
        authorId: s.authorId,
        articleTitle: 'Words',
        articleSlug: 'words',
        amountUsd: 0.1,
        amountCents: 10,
        expectedAmountStroops: '1000000',
        stellarTxId: 'ef'.repeat(32),
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      })
    })
    await v1RowsBulk(t, s.authorId, s.articleId, 2_100)
    // A short writer queued behind.
    await v1Rows(t, s.otherAuthorId, s.otherArticleId, 3)

    const first = await rebuildRun(t)
    expect(first).toEqual({
      status: 'ran',
      rebuilt: 1,
      inProgress: 1,
      failed: 0,
    })
    expect(await summaryOf(t, s.otherAuthorId)).toMatchObject(lifetime(3))
    // While the long row is rebuilt, the summary says so, with the previous
    // figures: 2,000 rows read, the pending tip among them (a lower bound).
    expect(await summary(t, s)).toMatchObject({
      tipCount: AGGREGATE_LIMIT - 1,
      complete: false,
      updating: true,
      source: 'previous',
    })
    const progress = (await earningsRow(t, s.authorId))!.lifetimeRebuild!
    expect(progress.phase).toBe('tips')

    // Tips arrive mid-rebuild: the pending v1 tip (a row it has read) is
    // verified, and a tab tip (a row it has not read) settles.
    await t.mutation(internal.articleTipVerify.confirmVerifiedArticleTip, {
      tipId: pendingId,
    })
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))

    // A row that never had a turn goes before the one that had one.
    await v1Rows(t, s.readerId, s.articleId, 1)
    const queue = await t.query(internal.earningsTotalsBackfill.pendingRows, {
      limit: 5,
    })
    const ids = await t.run(async (ctx) =>
      Promise.all(
        [s.readerId, s.authorId].map(
          async (userId) =>
            (await ctx.db.query('authorEarnings').collect()).find(
              (r) => r.userId === userId
            )!._id
        )
      )
    )
    expect(queue).toEqual(ids)

    await rebuildAll(t)
    // 2,101 v1 tips and one tab tip, each once.
    expect(await summary(t, s)).toMatchObject(lifetime(2_102))
    expect(await summaryOf(t, s.otherAuthorId)).toMatchObject(lifetime(3))
    expect(await summaryOf(t, s.readerId)).toMatchObject(lifetime(1))
  }, 120_000)

  it('pairs paid during the rebuild count once, read or not yet listed', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const NEW_WRITER = seedAddress(42)
    const THIRD_WRITER = seedAddress(43)
    const moveTo = (address: string) =>
      t.run(async (ctx) => {
        await ctx.db.patch(s.authorId, { stellarAddress: address })
        await ctx.db.patch(s.chainArticleId, { authorAddress: address })
      })
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    await moveTo(NEW_WRITER)
    await tip(t, s, { cents: 10 })
    await forgetTotals(t, s.authorId)
    const id = (await earningsRow(t, s.authorId))!._id
    const step = () =>
      t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    // `tips`, `highlightTips`, then the pairs of the current address.
    for (let i = 0; i < 3; i += 1) expect(await step()).toBe('more')
    expect((await earningsRow(t, s.authorId))!.lifetimeRebuild).toMatchObject({
      phase: 'pairs',
      writers: [NEW_WRITER, WRITER],
      writerIndex: 1,
    })
    // The pair it has read is paid.
    await settleAll(t, BigInt(1_000_000), NEW_WRITER)
    // A new address it never lists: accepted and paid.
    await moveTo(THIRD_WRITER)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000), THIRD_WRITER)
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED', 'SETTLED'])
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(3))
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(3))
  })

  it('the tab totals are credited once per settled receipt: replays and later events add nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    const settled = ev.tabSettled({
      cumulative: BigInt(1_000_000),
      paidAfter: BigInt(1_000_000),
      gross: BigInt(1_000_000),
    })
    const credited = async () => {
      const row = (await earningsRow(t, s.authorId))!
      return {
        tabTipCount: row.tabTipCount,
        tabEarnedCents: row.tabEarnedCents,
        tabSettledBaseUnits: row.tabSettledBaseUnits,
        tipCount: row.tipCount,
        totalEarnedCents: row.totalEarnedCents,
      }
    }
    await ingest(t, settled)
    const once = await credited()
    expect(once).toEqual({
      tabTipCount: 1,
      tabEarnedCents: 9.75,
      tabSettledBaseUnits: { [TOKEN]: '975000' },
      tipCount: 1,
      totalEarnedCents: 9.75,
    })
    // The same event again (a replay or a retried mutation).
    await ingest(t, settled)
    // Another report of the same payment.
    await settleAll(t, BigInt(1_000_000))
    // Later events on the pair and the key: a settled receipt stays settled.
    await ingest(t, ev.voucherSkipped(BigInt(1_000_000), 2))
    await ingest(t, ev.keyRevoked(READER, 0, LEDGER + 10))
    expect(await receiptStatuses(t)).toEqual(['SETTLED'])
    expect(await credited()).toEqual(once)
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(1))
  })

  it('each credit writes only its own totals: a row of another kind changes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1Rows(t, s.authorId, s.articleId, 1)
    await walletRows(t, s, 1)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    // The first receipt settles; the second stays accepted.
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(1_000_000),
        gross: BigInt(1_000_000),
      })
    )
    await rebuildAll(t)
    const before = await earningsRow(t, s.authorId)
    await t.run(async (ctx) => {
      const rows = (await ctx.db.query('tips').collect()).filter(
        (r) => r.authorId === s.authorId
      )
      const v1 = rows.find((r) => r.contractVersion === undefined)!
      const wallet = rows.find((r) => r.channel === 'direct')!
      const settledTab = rows.find(
        (r) => r.channel === 'tab' && r.earningsAppliedAt !== undefined
      )!
      const acceptedTab = rows.find(
        (r) => r.channel === 'tab' && r.earningsAppliedAt === undefined
      )!
      for (const row of [settledTab, acceptedTab, wallet]) {
        await creditV1TipTotals(ctx, s.authorId, 'tips', row)
      }
      // A tab change for a row that is not a tab tip.
      const tabDelta = {
        tabTipCount: 1,
        tabEarnedCents: 9.75,
        tabSettledBaseUnits: { [TOKEN]: '975000' },
      }
      for (const row of [v1, wallet]) {
        await creditTabTipTotals(ctx, s.authorId, 'tips', row, tabDelta)
      }
    })
    expect(await earningsRow(t, s.authorId)).toEqual(before)
  })

  /** A v1 tip verified through the real path, as a pending row first. */
  async function verifiedV1(t: T, s: Seeded) {
    const tipId = await t.run(async (ctx) => {
      const now = Date.now()
      return ctx.db.insert('tips', {
        articleId: s.articleId,
        tipperId: s.readerId,
        authorId: s.authorId,
        articleTitle: 'Words',
        articleSlug: 'words',
        amountUsd: 0.1,
        amountCents: 10,
        expectedAmountStroops: '1000000',
        stellarTxId: crypto.randomUUID(),
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      })
    })
    await t.mutation(internal.articleTipVerify.confirmVerifiedArticleTip, {
      tipId,
    })
    return tipId
  }

  it('a v1 tip marked fraudulent leaves all three figures, live and during a rebuild', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Live: rebuilt totals, then reconciliation marks the tip fraudulent.
    const first = await verifiedV1(t, s)
    const second = await verifiedV1(t, s)
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(2))
    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId: first,
      reason: 'test',
    })
    expect(await summary(t, s)).toMatchObject(lifetime(1))
    // During a rebuild that has read the tip.
    await v1RowsBulk(t, s.authorId, s.articleId, 250)
    await forgetTotals(t, s.authorId)
    const id = (await earningsRow(t, s.authorId))!._id
    expect(
      await t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    ).toBe('more')
    await t.mutation(internal.tips.markArticleTipFraudulent, {
      tipId: second,
      reason: 'test',
    })
    await rebuildAll(t)
    // 250 bulk v1 tips; both verified tips are out.
    expect(await summary(t, s)).toMatchObject(lifetime(250))
    expect(await liveEqualsHistory(t, s.authorId)).toMatchObject(lifetime(250))
  }, 60_000)

  /** `n` other pairs of the writer's address, unpaid, with keys from `from`. */
  async function otherPairs(t: T, s: Seeded, from: number, n: number) {
    await t.run(async (ctx) => {
      const account = (await ctx.db.query('tabAccounts').first())!
      const now = Date.now()
      for (let i = 0; i < n; i += 1) {
        await ctx.db.insert('tabVouchers', {
          network: 'TESTNET',
          chainEpoch: EPOCH,
          tabAccountId: account._id,
          tabContractId: TAB,
          tokenContractId: TOKEN,
          readerAddress: READER,
          keyId: 1000 + from + i,
          writerAddress: WRITER,
          authorId: s.authorId,
          cumulative: '0',
          receiptsRoot: '00'.repeat(32),
          leafHashes: [],
          signature: '00'.repeat(64),
          acceptance: { acceptor: ACCEPTOR_PUBLIC, signature: '00'.repeat(64) },
          seq: 0,
          paidOnChain: '0',
          unsettled: false,
          state: 'UNPAID',
          settleQueue: 'done',
          earnedNet: '0',
          pendingNet: '0',
          acceptedAt: now,
          updatedAt: now,
        })
      }
    })
  }

  it('a pair paid mid-page during the pairs phase counts once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // The tipped pair is the fourth of 254: inside the first page of 200,
    // neither its first nor its last row, and the phase goes on after it.
    await otherPairs(t, s, 0, 3)
    await tip(t, s, { cents: 10 })
    await otherPairs(t, s, 3, 250)
    await forgetTotals(t, s.authorId)
    const id = (await earningsRow(t, s.authorId))!._id
    const step = () =>
      t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    // `tips`, `highlightTips`, then the first page of pairs.
    for (let i = 0; i < 3; i += 1) expect(await step()).toBe('more')
    const r = (await earningsRow(t, s.authorId))!.lifetimeRebuild!
    expect(r).toMatchObject({ phase: 'pairs', writerIndex: 0 })
    expect(r.cursor).toBeTypeOf('string')
    const byWriter = (
      await t.run(async (ctx) => ctx.db.query('tabVouchers').collect())
    ).sort((a, b) => a._creationTime - b._creationTime)
    const tipped = byWriter.findIndex((v) => v.keyId === 0)
    expect(tipped).toBe(3)
    expect(r.lastCreationTime).toBe(byWriter[199]!._creationTime)
    // The pair the step has read is paid now.
    await settleAll(t, BigInt(1_000_000))
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(1))
    expect(
      (await earningsRow(t, s.authorId))!.walletEarnedBaseUnits?.[TOKEN] ?? '0'
    ).toBe('0')
  }, 60_000)

  for (const table of ['tips', 'highlightTips'] as const) {
    it(`a tab tip paid mid-page during the ${table} phase counts once`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      // The tab row is the fourth of 254 rows of the table: inside the first
      // page of 200, neither its first nor its last row.
      await walletRowsBulk(t, s, 3, table)
      await tip(t, s, {
        cents: 10,
        ...(table === 'highlightTips' ? { highlight: HIGHLIGHT } : {}),
      })
      await walletRowsBulk(t, s, 250, table)
      await forgetTotals(t, s.authorId)
      const id = (await earningsRow(t, s.authorId))!._id
      const step = () =>
        t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
      // For passage rows the article phase comes first, empty here.
      const steps = table === 'tips' ? 1 : 2
      for (let i = 0; i < steps; i += 1) expect(await step()).toBe('more')
      const r = (await earningsRow(t, s.authorId))!.lifetimeRebuild!
      expect(r.phase).toBe(table)
      const rows = (
        await t.run(async (ctx) => ctx.db.query(table).collect())
      ).filter((row) => row.authorId === s.authorId)
      expect(rows.findIndex((row) => row.channel === 'tab')).toBe(3)
      expect(r.lastCreationTime).toBe(rows[199]!._creationTime)
      // The tab row the step has read is paid now.
      await settleAll(t, BigInt(1_000_000))
      await rebuildAll(t)
      expect(await summary(t, s)).toMatchObject(lifetime(254))
    }, 60_000)
  }

  it('a credit to the last row a rebuild step read counts once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRowsBulk(t, s, 199)
    // The 200th row: the last one the first page reads.
    await tip(t, s, { cents: 10 })
    await walletRowsBulk(t, s, 5)
    await forgetTotals(t, s.authorId)
    const id = (await earningsRow(t, s.authorId))!._id
    expect(
      await t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    ).toBe('more')
    const tabRow = await t.run(
      async (ctx) =>
        (await ctx.db.query('tips').collect()).find((r) => r.channel === 'tab')!
    )
    expect(
      (await earningsRow(t, s.authorId))!.lifetimeRebuild!.lastCreationTime
    ).toBe(tabRow._creationTime)
    await settleAll(t, BigInt(1_000_000))
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(205))
  }, 60_000)

  it('a pair of an old address paid before the rebuild lists the address counts once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletRowsBulk(t, s, 250)
    // To the old address, after the first page.
    await tip(t, s, { cents: 10 })
    const NEW_WRITER = seedAddress(43)
    await t.run(async (ctx) => {
      await ctx.db.patch(s.authorId, { stellarAddress: NEW_WRITER })
      await ctx.db.patch(s.chainArticleId, { authorAddress: NEW_WRITER })
    })
    await forgetTotals(t, s.authorId)
    const id = (await earningsRow(t, s.authorId))!._id
    expect(
      await t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    ).toBe('more')
    expect(
      (await earningsRow(t, s.authorId))!.lifetimeRebuild!.writers
    ).toEqual([NEW_WRITER])
    // The old pair is paid: held apart until the tab row lists the address.
    await settleAll(t, BigInt(1_000_000))
    expect(
      Object.keys(
        (await earningsRow(t, s.authorId))!.lifetimeRebuild!.unlistedPairNet
      )
    ).toEqual([WRITER])
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(251))
  }, 60_000)

  /** A total of zero and a missing total are the same. */
  const zeroAsMissing = (value: unknown) =>
    value === undefined ||
    value === 0 ||
    value === '0' ||
    (typeof value === 'object' &&
      value !== null &&
      Object.values(value).every((n) => n === '0'))
      ? null
      : value

  /** The rebuild from history gives what the live credits gave. */
  async function rebuiltEqualsLive(t: T, userId: Id<'users'>) {
    const live = (await summaryOf(t, userId))!
    const row = (await earningsRow(t, userId))!
    await forgetTotals(t, userId)
    await rebuildAll(t)
    expect(await summaryOf(t, userId)).toEqual(live)
    const rebuilt = (await earningsRow(t, userId))!
    for (const field of [
      'tabTipCount',
      'tabEarnedCents',
      'tabSettledBaseUnits',
      'walletEarnedBaseUnits',
      'v1TipCount',
      'v1EarnedCents',
      'v1ShareStroops',
    ] as const) {
      expect(zeroAsMissing(rebuilt[field])).toEqual(zeroAsMissing(row[field]))
    }
    return live
  }

  /** The tab figures from the chain records: pair paid amounts and receipts. */
  async function fromChain(t: T, userId: Id<'users'>) {
    return t.run(async (ctx) => {
      const pairs = (await ctx.db.query('tabVouchers').collect()).filter(
        (p) => p.authorId === userId
      )
      let units = BigInt(0)
      let cents = 0
      let tips = 0
      for (const pair of pairs) {
        units += BigInt(pair.earnedNet)
        const receipts = (await ctx.db.query('tabReceipts').collect()).filter(
          (r) =>
            r.tabAccountId === pair.tabAccountId &&
            r.keyId === pair.keyId &&
            r.writerAddress === pair.writerAddress
        )
        for (const receipt of receipts) {
          const paid = receiptPaidNet(receipt, BigInt(pair.paidOnChain))
          if (paid <= BigInt(0)) continue
          const row = (await ctx.db.get(receipt.tipRowId))!
          tips += 1
          cents = roundCents(
            cents + tabShareCents(row.amountCents, paid, BigInt(receipt.amount))
          )
        }
      }
      return { units: units.toString(), cents, tips }
    })
  }

  async function expectTabTotals(
    t: T,
    s: Seeded,
    f: { tips: number; units: string; cents: number }
  ) {
    const row = (await earningsRow(t, s.authorId))!
    expect({
      tips: row.tabTipCount ?? 0,
      units: row.tabSettledBaseUnits?.[TOKEN] ?? '0',
      cents: row.tabEarnedCents ?? 0,
    }).toEqual(f)
    expect(await fromChain(t, s.authorId)).toEqual(f)
  }

  it('a short settlement, then the rest: the remainder enters as a change, the tip counted once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    // Receipt 1 in full, 0.5 of receipt 2's 2.5 XLM: 975,000 + 487,500.
    await expectTabTotals(t, s, { tips: 2, units: '1462500', cents: 14.625 })
    await rebuiltEqualsLive(t, s.authorId)
    const rest = ev.tabSettled({
      cumulative: BigInt(3_500_000),
      paidAfter: BigInt(3_500_000),
      gross: BigInt(2_000_000),
    })
    await ingest(t, rest)
    await ingest(t, rest)
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    await expectTabTotals(t, s, { tips: 2, units: '3412500', cents: 34.125 })
    expect(await rebuiltEqualsLive(t, s.authorId)).toMatchObject({
      tipCount: 2,
      earnedStroops: '3412500',
      estimatedUsd: 0.34125,
    })
  })

  it('the dollars keep the tip quote when the price changes before the payment: live, replayed, dry run and rebuilt', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Quoted at $1 per XLM: 10 and 25 cents are 0.1 and 0.25 XLM.
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    // The price doubles before the pair is paid.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('xlmPriceCache').collect()) {
        await ctx.db.patch(row._id, { priceUsd: 2, fetchedAt: Date.now() })
      }
    })
    /** The dry run's view of this writer: nothing to change, same figures. */
    async function dryRunAgrees() {
      const live = (await rawSummary(t, s.authorId))!.lifetime!
      const report = await t.action(internal.earningsTotalsBackfill.dryRun, {})
      const mine = report.rows.find((r) => r.userId === s.authorId)!
      expect(mine.changedFields).toEqual([])
      expect(mine.rebuilt).toEqual({
        tipCount: live.tipCount,
        earnedStroops: live.earnedStroops,
        estimatedUsd: live.estimatedUsd,
      })
    }
    const short = ev.tabSettled({
      cumulative: BigInt(3_500_000),
      paidAfter: BigInt(1_500_000),
      gross: BigInt(1_500_000),
    })
    await ingest(t, short)
    // 9.75 + 25 × 0.195 cents, from the quotes, not from $2 per XLM.
    const partly = { tips: 2, units: '1462500', cents: 14.625 }
    await expectTabTotals(t, s, partly)
    // A replay of the same event.
    await ingest(t, short)
    await expectTabTotals(t, s, partly)
    await dryRunAgrees()
    await rebuiltEqualsLive(t, s.authorId)
    // The rest is paid later: a change only, at the same quotes.
    const rest = ev.tabSettled({
      cumulative: BigInt(3_500_000),
      paidAfter: BigInt(3_500_000),
      gross: BigInt(2_000_000),
    })
    await ingest(t, rest)
    await ingest(t, rest)
    const paid = { tips: 2, units: '3412500', cents: 34.125 }
    await expectTabTotals(t, s, paid)
    await dryRunAgrees()
    expect(await rebuiltEqualsLive(t, s.authorId)).toMatchObject({
      tipCount: 2,
      earnedStroops: '3412500',
      estimatedUsd: 0.34125,
    })
  })

  it('a short settlement, then UNPAID: the net paid on chain stays in all three', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    const end = VALID_UNTIL + SETTLE_GRACE_LEDGERS + 10
    await setLedger(t, end)
    await ingest(t, ev.voucherSkipped(BigInt(3_500_000), 2, { ledger: end }))
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'UNPAID'])
    // The pair's paid net, 1,462,500, not the settled receipt's 975,000.
    expect((await voucherRow(t)).earnedNet).toBe('1462500')
    await expectTabTotals(t, s, { tips: 2, units: '1462500', cents: 14.625 })
    expect(await rebuiltEqualsLive(t, s.authorId)).toMatchObject({
      tipCount: 2,
      earnedStroops: '1462500',
      estimatedUsd: 0.14625,
    })
  })

  it('several short settlements of one tip: counted once, each paid part added', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 25 })
    let paid = BigInt(0)
    const expected = [
      // 0.5 XLM: 25 × 0.195 cents.
      { paidAfter: BigInt(500_000), units: '487500', cents: 4.875 },
      // 1.2 XLM: 25 × 0.468 cents.
      { paidAfter: BigInt(1_200_000), units: '1170000', cents: 11.7 },
      // All 2.5 XLM: 25 × 0.975 cents.
      { paidAfter: BigInt(2_500_000), units: '2437500', cents: 24.375 },
    ]
    for (const step of expected) {
      await ingest(
        t,
        ev.tabSettled({
          cumulative: BigInt(2_500_000),
          paidAfter: step.paidAfter,
          gross: step.paidAfter - paid,
        })
      )
      paid = step.paidAfter
      await expectTabTotals(t, s, {
        tips: 1,
        units: step.units,
        cents: step.cents,
      })
      await rebuiltEqualsLive(t, s.authorId)
    }
  })

  it('property: over random settlements, shortfalls, replays and unpaid ends, the tab totals are the paid net on chain', async () => {
    let state = 552
    const rand = (n: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state % n
    }
    for (let run = 0; run < 10; run += 1) {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      let cumulative = BigInt(0)
      for (let k = 1 + rand(4); k > 0; k -= 1) {
        const cents = 1 + rand(60)
        await tip(t, s, { cents })
        cumulative += BigInt(cents) * BigInt(100_000)
      }
      let paid = BigInt(0)
      let last: RawRpcEvent | null = null
      for (let n = 1 + rand(5); n > 0; n -= 1) {
        const action = rand(5)
        if (action <= 1 && paid < cumulative) {
          // A settlement of part of what is owed, or all of it.
          const owed = cumulative - paid
          const part = action === 0 ? BigInt(1 + rand(Number(owed))) : owed
          last = ev.tabSettled({
            cumulative,
            paidAfter: paid + part,
            gross: part,
          })
          paid += part
          await ingest(t, last)
        } else if (action === 2 && last) {
          await ingest(t, last)
        } else if (action === 3) {
          await ingest(t, ev.voucherSkipped(cumulative, 4))
        } else {
          const end = VALID_UNTIL + SETTLE_GRACE_LEDGERS + 10
          await setLedger(t, end)
          await ingest(t, ev.voucherSkipped(cumulative, 2, { ledger: end }))
          break
        }
        const chain = await fromChain(t, s.authorId)
        const row = (await earningsRow(t, s.authorId))!
        expect({
          tips: row.tabTipCount ?? 0,
          units: row.tabSettledBaseUnits?.[TOKEN] ?? '0',
          cents: row.tabEarnedCents ?? 0,
        }).toEqual(chain)
        expect(chain.units).toBe(netOf(paid).toString())
      }
      await rebuiltEqualsLive(t, s.authorId)
    }
  }, 120_000)

  it('previous figures until the row is rebuilt, the lifetime totals after', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 50 })
    await tip(t, s, { cents: 50 })
    await tip(t, s, { cents: 25 })
    await settleAll(t, BigInt(12_500_000))
    const tabNet = netOf(BigInt(12_500_000))
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('authorEarnings').collect()).find(
        (r) => r.userId === s.authorId
      )!
      await ctx.db.patch(row._id, {
        earnedBaseUnits: { [TOKEN]: '1145760615' },
        walletEarnedBaseUnits: {
          [TOKEN]: (BigInt('1145760615') - tabNet).toString(),
        },
        v2EarnedCents: 1365,
        v2TipCount: 6,
      })
    })
    await forgetTotals(t, s.authorId)
    // What the stats page showed before #552 for the integration writer.
    expect(await summary(t, s)).toMatchObject({
      tipCount: 6,
      earnedStroops: '1145760615',
      estimatedUsd: 13.65,
      source: 'previous',
      updating: false,
    })
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject({
      tipCount: 9,
      earnedStroops: '1145760615',
      estimatedUsd: 14.86875,
      source: 'lifetime',
    })
  })

  it('the switch: off reads and writes nothing, a row keeps its place, on resumes', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await v1RowsBulk(t, s.authorId, s.articleId, 450)
    const before = await earningsRow(t, s.authorId)
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'false')
    expect(await rebuildRun(t)).toEqual({
      status: 'disabled',
      rebuilt: 0,
      inProgress: 0,
      failed: 0,
    })
    expect(await earningsRow(t, s.authorId)).toEqual(before)
    // On for one step, then off: the position stays.
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'true')
    await t.mutation(internal.earningsTotalsBackfill.rebuildStep, {
      id: before!._id,
    })
    const paused = await earningsRow(t, s.authorId)
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'false')
    expect((await rebuildRun(t)).status).toBe('disabled')
    expect(await earningsRow(t, s.authorId)).toEqual(paused)
    expect(paused!.lifetimeRebuild).toMatchObject({ phase: 'tips', steps: 1 })
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'true')
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(450))
  }, 60_000)

  it('the dry run reports what a rebuild would write, and writes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1Rows(t, s.authorId, s.articleId, 1)
    await walletRows(t, s, 1)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    const all = () =>
      t.run(async (ctx) => ctx.db.query('authorEarnings').collect())
    const before = await all()
    const report = await t.action(internal.earningsTotalsBackfill.dryRun, {})
    expect(await all()).toEqual(before)
    expect(report.isDone).toBe(true)
    const mine = report.rows.find((r) => r.userId === s.authorId)!
    expect(mine).toMatchObject({
      source: 'previous',
      // Before: the tab tip in the XLM only.
      shown: {
        tipCount: 2,
        earnedStroops: '2925000',
        estimatedUsd: 0.195,
      },
      rebuilt: {
        tipCount: 3,
        earnedStroops: '2925000',
        estimatedUsd: 0.2925,
      },
    })
    // The wallet and tab totals were credited live; the v1 tip was credited
    // before the v1 totals existed, so only they change.
    expect([...mine.changedFields].sort()).toEqual([
      'v1EarnedCents',
      'v1ShareStroops',
      'v1TipCount',
    ])
  })

  it('progress lists rebuilt, waiting, in-progress and failed rows; reset restarts or removes', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1RowsBulk(t, s.authorId, s.articleId, 450)
    await v1Rows(t, s.otherAuthorId, s.otherArticleId, 2)
    const [mine, other] = await t.run(async (ctx) => {
      const rows = await ctx.db.query('authorEarnings').collect()
      return [s.authorId, s.otherAuthorId].map(
        (userId) => rows.find((r) => r.userId === userId)!._id
      )
    })
    await t.mutation(internal.earningsTotalsBackfill.rebuildStep, {
      id: mine!,
    })
    await t.mutation(internal.earningsTotalsBackfill.recordError, {
      id: other!,
      error: 'test error',
    })
    let p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p).toMatchObject({
      enabled: true,
      total: 2,
      rebuilt: 0,
      waiting: 0,
      failed: [{ id: other, userId: s.otherAuthorId, error: 'test error' }],
      settledTabRowsWithoutApplied: 0,
      complete: true,
    })
    expect(p.inProgress).toEqual([
      expect.objectContaining({ userId: s.authorId, phase: 'tips', steps: 1 }),
    ])
    // The failed row is skipped until it is put back.
    await rebuildAll(t)
    p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p).toMatchObject({ rebuilt: 1, waiting: 0, inProgress: [] })
    expect(p.failed).toHaveLength(1)
    expect(
      await t.mutation(internal.earningsTotalsBackfill.retryFailed, {})
    ).toEqual({ retried: 1 })
    await rebuildAll(t)
    p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p).toMatchObject({
      rebuilt: 2,
      waiting: 0,
      inProgress: [],
      failed: [],
    })
    const rebuilt = await summary(t, s)

    // Restart: every row is rebuilt again, to the same figures.
    await t.action(internal.earningsTotalsBackfill.reset, { mode: 'restart' })
    expect(await summary(t, s)).toMatchObject({ source: 'previous' })
    await rebuildAll(t)
    expect(await summary(t, s)).toEqual(rebuilt)

    // Remove: the shape before #552.
    await t.action(internal.earningsTotalsBackfill.reset, { mode: 'remove' })
    const row = (await earningsRow(t, s.authorId))!
    for (const field of [
      'v1TipCount',
      'v1EarnedCents',
      'v1ShareStroops',
      'v1UnpricedTipCount',
      'tabTipCount',
      'tabEarnedCents',
      'tabSettledBaseUnits',
      'walletEarnedBaseUnits',
      'lifetimeTotalsAt',
      'lifetimeRebuild',
      'lifetimeRebuildTurnAt',
      'lifetimeRebuildError',
      'lifetimeRebuildFailedAt',
    ] as const) {
      expect(row[field]).toBeUndefined()
    }
  }, 60_000)

  it('a row that fails is recorded and skipped; the rows around it are rebuilt, and it is retried on request', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Three rows: the middle one cannot be read (an unparsable amount).
    await v1Rows(t, s.authorId, s.articleId, 2)
    await v1Rows(t, s.otherAuthorId, s.otherArticleId, 2)
    await v1Rows(t, s.readerId, s.articleId, 2)
    const poisoned = (await earningsRow(t, s.otherAuthorId))!
    await t.run(async (ctx) => {
      await ctx.db.patch(poisoned._id, {
        earnedBaseUnits: { [TOKEN]: 'not a number' },
      })
    })
    expect(await rebuildRun(t)).toEqual({
      status: 'ran',
      rebuilt: 2,
      inProgress: 0,
      failed: 1,
    })
    expect(await summary(t, s)).toMatchObject(lifetime(2))
    expect(await summaryOf(t, s.readerId)).toMatchObject(lifetime(1 + 1))
    let p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p.failed).toEqual([
      expect.objectContaining({
        id: poisoned._id,
        userId: s.otherAuthorId,
        error: expect.stringContaining('not a number'),
      }),
    ])
    // Later runs skip it: nothing is retried until asked.
    const failedRow = await earningsRow(t, s.otherAuthorId)
    expect(await rebuildRun(t)).toEqual({
      status: 'ran',
      rebuilt: 0,
      inProgress: 0,
      failed: 0,
    })
    expect(await earningsRow(t, s.otherAuthorId)).toEqual(failedRow)
    // Fixed and put back: it resumes and finishes.
    await t.run(async (ctx) => {
      await ctx.db.patch(poisoned._id, { earnedBaseUnits: {} })
    })
    expect(
      await t.mutation(internal.earningsTotalsBackfill.retryFailed, {
        id: poisoned._id,
      })
    ).toEqual({ retried: 1 })
    await rebuildAll(t)
    expect(await summaryOf(t, s.otherAuthorId)).toMatchObject(lifetime(2))
    p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p).toMatchObject({ failed: [], waiting: 0, rebuilt: 3 })
  })

  it('a settled tab row without earningsAppliedAt is counted from its receipt and pair, and shown in progress', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    // As if an older write path had set the status alone.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('tips').collect()).find(
        (r) => r.channel === 'tab'
      )!
      expect(row.status).toBe('SETTLED')
      await ctx.db.patch(row._id, { earningsAppliedAt: undefined })
    })
    const p = await t.query(internal.earningsTotalsBackfill.progress, {})
    expect(p.settledTabRowsWithoutApplied).toBe(1)
    await forgetTotals(t, s.authorId)
    await rebuildAll(t)
    expect(await summary(t, s)).toMatchObject(lifetime(1))
  })

  /**
   * `getMyEarningsSummary` as `overhaul/v2` computes it before #552, run on
   * the same data: the values a client built before #552 must keep reading.
   */
  async function previousSummary(t: T, userId: Id<'users'>) {
    return t.run(async (ctx) => {
      const share = (tip: {
        expectedAmountStroops?: string
        stellarAmountXlm?: string
      }) => {
        let stroops: bigint | null = null
        if (
          tip.expectedAmountStroops &&
          /^[1-9]\d*$/.test(tip.expectedAmountStroops)
        ) {
          stroops = BigInt(tip.expectedAmountStroops)
        } else if (
          tip.stellarAmountXlm &&
          /^\d+(\.\d{1,7})?$/.test(tip.stellarAmountXlm)
        ) {
          const [whole, fraction = ''] = tip.stellarAmountXlm.split('.')
          stroops = BigInt(whole ?? '0') * XLM + BigInt(fraction.padEnd(7, '0'))
        }
        if (!stroops || stroops <= BigInt(0)) return null
        return stroops - (stroops * BigInt(250)) / BigInt(10_000)
      }
      const byAuthor = async (table: 'tips' | 'highlightTips') =>
        (await ctx.db.query(table).collect())
          .filter((r) => r.authorId === userId)
          .slice(0, AGGREGATE_LIMIT + 1)
      const articleTips = await byAuthor('tips')
      const passageTips = await byAuthor('highlightTips')
      const earnings =
        (await ctx.db.query('authorEarnings').collect()).find(
          (r) => r.userId === userId
        ) ?? null
      const complete =
        articleTips.length <= AGGREGATE_LIMIT &&
        passageTips.length <= AGGREGATE_LIMIT
      const v1Tips = [
        ...articleTips.slice(0, AGGREGATE_LIMIT),
        ...passageTips.slice(0, AGGREGATE_LIMIT),
      ].filter(
        (tip) =>
          (tip.contractVersion ?? 'v1') === 'v1' &&
          tip.status === 'CONFIRMED' &&
          typeof tip.verifiedAt === 'number' &&
          tip.verifiedAt > 0
      )
      let stroops = BigInt(0)
      let cents = 0
      for (const tip of v1Tips) {
        stroops += share(tip) ?? BigInt(0)
        if (!('amountUsdSuspicious' in tip && tip.amountUsdSuspicious)) {
          cents += writerShareCents(tip.amountCents, tip.expectedAmountStroops)
        }
      }
      const v2Xlm = BigInt(earnings?.earnedBaseUnits?.[TOKEN] ?? '0')
      return {
        network: 'TESTNET',
        tipCount: v1Tips.length + (earnings?.v2TipCount ?? 0),
        writerShareStroops: stroops.toString(),
        earnedStroops: (stroops + v2Xlm).toString(),
        estimatedUsd: roundCents(cents + (earnings?.v2EarnedCents ?? 0)) / 100,
        earnedBaseUnits: earnings?.earnedBaseUnits ?? {},
        v2TipCount: earnings?.v2TipCount ?? 0,
        complete,
      }
    })
  }

  it('a client built before #552 reads the same figures before, during and after the rebuild', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1Rows(t, s.authorId, s.articleId, 2)
    await walletRows(t, s, 2)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    // The fields that client reads, called as it calls the query.
    const oldClient = async () => {
      const r = (await as(t, s.authorId).query(
        api.tips.getMyEarningsSummary,
        {}
      ))!
      return {
        network: r.network,
        tipCount: r.tipCount,
        writerShareStroops: r.writerShareStroops,
        earnedStroops: r.earnedStroops,
        estimatedUsd: r.estimatedUsd,
        earnedBaseUnits: r.earnedBaseUnits,
        v2TipCount: r.v2TipCount,
        complete: r.complete,
      }
    }
    // Before the rebuild (the row was created with v1 rows behind it).
    expect((await earningsRow(t, s.authorId))?.lifetimeTotalsAt).toBeUndefined()
    expect(await oldClient()).toEqual(await previousSummary(t, s.authorId))
    // During it.
    const id = (await earningsRow(t, s.authorId))!._id
    await t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    expect((await rawSummary(t, s.authorId))?.updating).toBe(true)
    expect(await oldClient()).toEqual(await previousSummary(t, s.authorId))
    // After it: the same fields, and the lifetime totals beside them.
    await rebuildAll(t)
    const after = (await rawSummary(t, s.authorId))!
    expect(await oldClient()).toEqual(await previousSummary(t, s.authorId))
    expect(after.lifetime).toEqual({
      // 2 v1, 2 wallet and 2 tab tips (one partly paid).
      tipCount: 6,
      writerShareStroops: '1950000',
      earnedStroops: (
        BigInt(4) * BigInt(975_000) +
        BigInt(1_462_500)
      ).toString(),
      estimatedUsd: 0.53625,
      unpricedTipCount: 0,
    })
    // The previous fields still read the tab pair's payment in the XLM only.
    expect(after).toMatchObject({ tipCount: 4, estimatedUsd: 0.39 })
  })

  it('the rebuild writes only authorEarnings, and running it again changes nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await v1Rows(t, s.authorId, s.articleId, 2)
    await walletRows(t, s, 2)
    await tip(t, s, { cents: 10 })
    await settleAll(t, BigInt(1_000_000))
    await forgetTotals(t, s.authorId)
    const OTHER_TABLES = [
      'tips',
      'highlightTips',
      'users',
      'articles',
      'chainArticles',
      'tabAccounts',
      'tabReceipts',
      'tabVouchers',
      'tabSettlements',
      'tabSessionKeys',
    ] as const
    const others = () =>
      t.run(async (ctx) =>
        Promise.all(OTHER_TABLES.map((table) => ctx.db.query(table).collect()))
      )
    const rows = () =>
      t.run(async (ctx) => ctx.db.query('authorEarnings').collect())
    const before = await others()
    await rebuildAll(t)
    expect(await others()).toEqual(before)
    const once = await rows()
    expect(await summary(t, s)).toMatchObject(lifetime(5))
    expect(await rebuildRun(t)).toEqual({
      status: 'ran',
      rebuilt: 0,
      inProgress: 0,
      failed: 0,
    })
    // A step on a rebuilt row does nothing.
    const id = (await earningsRow(t, s.authorId))!._id
    expect(
      await t.mutation(internal.earningsTotalsBackfill.rebuildStep, { id })
    ).toBe('done')
    expect(await rows()).toEqual(once)
    expect(await others()).toEqual(before)
  }, 60_000)
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

  it('more than 256 debits after an absolute balance, then a re-dispatch of the oldest, debits it once (#576)', async () => {
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
    // Before #576 the oldest debit was cut from a 256-entry list.
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
  })

  // -------------------------------------------------------------------------
  // #576: each `TabSettled` debit counted once, however many there are.

  const GROSS = BigInt(1000)
  /** A settlement of the other writer's pair, which has no voucher here. */
  const otherSettled = (i: number, ledger: number) =>
    ev.tabSettled(
      {
        writer: OTHER_WRITER,
        cumulative: GROSS * BigInt(i + 1),
        paidAfter: GROSS * BigInt(i + 1),
        gross: GROSS,
      },
      { ledger }
    )
  async function ingestAll(t: T, events: RawRpcEvent[]) {
    for (let i = 0; i < events.length; i += 100) {
      await ingest(t, ...events.slice(i, i + 100))
    }
  }
  /** Marks stored events `pending` (all, or those ids) and dispatches them. */
  async function redispatchEvents(t: T, ids?: string[]) {
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        if (!ids || ids.includes(row.eventId)) {
          await ctx.db.patch(row._id, { handled: 'pending' })
        }
      }
    })
    for (;;) {
      const r = await t.mutation(internal.chain.indexer.redispatch, {
        limit: 500,
      })
      if (r.checked === 0) break
    }
  }
  const balanceOf = async (t: T) => BigInt((await account(t)).confirmedBalance)
  const debitRows = (t: T) =>
    t.run(
      async (ctx) => (await ctx.db.query('tabBalanceDebits').collect()).length
    )

  // 2,000 settlements, each dispatched twice: a few seconds on CI, more
  // than a minute on a heavily loaded machine.
  it.each([300, 2000])(
    '%i settlements after a balance: the oldest and a middle one re-dispatched, then a full replay, each debited once (#576)',
    async (n) => {
      const t = convexTest(schema, modules)
      await seed(t)
      const events = Array.from({ length: n }, (_, i) =>
        otherSettled(i, LEDGER + 1 + i)
      )
      await ingestAll(t, events)
      const expected = BigInt(10) * XLM - GROSS * BigInt(n)
      expect(await balanceOf(t)).toBe(expected)
      await redispatchEvents(t, [events[0]!.id, events[n >> 1]!.id])
      expect(await balanceOf(t)).toBe(expected)
      await ingestAll(t, events)
      await redispatchEvents(t)
      expect(await balanceOf(t)).toBe(expected)
      expect(await debitRows(t)).toBe(n)
      // The account row does not grow with the number of settlements.
      const row = await account(t)
      expect(row.settledSinceBalance).toEqual([])
      expect(JSON.stringify(row).length).toBeLessThan(2_000)
    },
    300_000
  )

  it('a late older absolute balance after more than 256 debits subtracts every one of them (#576)', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const events = Array.from({ length: 300 }, (_, i) =>
      otherSettled(i, LEDGER + 10 + i)
    )
    await ingestAll(t, events)
    // A deposit from before all of them is indexed late.
    await ingest(
      t,
      ev.deposited(READER, XLM, BigInt(11) * XLM, { ledger: LEDGER + 5 })
    )
    const expected = BigInt(11) * XLM - GROSS * BigInt(300)
    expect(await balanceOf(t)).toBe(expected)
    expect(await debitRows(t)).toBe(300)
    // A newer balance covers them all: the rows go, nothing is counted again.
    await ingest(
      t,
      ev.deposited(READER, XLM, expected + XLM, { ledger: LEDGER + 1000 })
    )
    expect(await balanceOf(t)).toBe(expected + XLM)
    expect(await debitRows(t)).toBe(0)
    await redispatchEvents(t)
    expect(await balanceOf(t)).toBe(expected + XLM)
  })

  it('the reconciliation leaves no debit to count twice (#576)', async () => {
    const flagged = negatives()
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    // The settler's settlement event is lost; 300 settlements of another
    // pair follow (0.03 in all).
    await settlerRecord(t, settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    await ingestAll(
      t,
      Array.from({ length: 300 }, (_, i) => otherSettled(i, LEDGER + 2 + i))
    )
    expect(await debitRows(t)).toBe(300)
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 400,
        balance: BigInt(2) * CENT,
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      })
    ).toMatchObject({ status: 'applied' })
    expect(await debitRows(t)).toBe(0)
    await redispatchEvents(t)
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(2) * CENT).toString(),
      available: (BigInt(2) * CENT).toString(),
    })
    expect(flagged()).toEqual([])
  })

  it('rows written before the change: list entries still count, and the next balance drains them (#576)', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const events = [1, 2, 3].map((i) => otherSettled(i, LEDGER + i))
    await ingest(t, ...events)
    // As written before this change: the debits in the list, no rows.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('tabBalanceDebits').collect()
      const row = (await ctx.db.query('tabAccounts').first())!
      await ctx.db.patch(row._id, {
        settledSinceBalance: rows.map((r) => ({
          eventId: r.eventId,
          gross: r.gross,
        })),
      })
      for (const r of rows) await ctx.db.delete(r._id)
    })
    const expected = BigInt(10) * XLM - GROSS * BigInt(3)
    await redispatchEvents(t, [events[1]!.id])
    expect(await balanceOf(t)).toBe(expected)
    expect(await debitRows(t)).toBe(0)
    // A late deposit from before them still subtracts the listed debits.
    await ingest(
      t,
      ev.deposited(READER, XLM, BigInt(11) * XLM, { ledger: LEDGER })
    )
    expect(await balanceOf(t)).toBe(BigInt(11) * XLM - GROSS * BigInt(3))
    // A newer balance drains the list.
    await ingest(
      t,
      ev.deposited(READER, XLM, BigInt(12) * XLM, { ledger: LEDGER + 9 })
    )
    expect(await account(t)).toMatchObject({
      confirmedBalance: (BigInt(12) * XLM).toString(),
      settledSinceBalance: [],
    })
  })

  it('a pair written before #565 with its event still in flight is debited once (#576)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    // As the code before #565 left it: paid raised by the settler's record,
    // no reserve, no indexed ranges, the balance not yet debited.
    await t.run(async (ctx) => {
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, {
        indexedPaid: undefined,
        paidLedger: undefined,
      })
      const row = (await ctx.db.query('tabAccounts').first())!
      await ctx.db.patch(row._id, {
        settledUnindexed: undefined,
        settledUnindexedSince: undefined,
      })
    })
    const event = settledEvent(paid, { ledger: LEDGER + 1 })
    await ingest(t, event)
    await ingest(t, event)
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(5) * CENT).toString(),
      available: (BigInt(5) * CENT).toString(),
    })
  })

  it('a late balance with more later debits than one update may read applies nothing, until a reconciliation (#576)', async () => {
    vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', '50')
    const { t, s } = await opened(BigInt(30) * CENT, [])
    const events = Array.from({ length: 60 }, (_, i) =>
      otherSettled(i, LEDGER + 10 + i)
    )
    await ingestAll(t, events)
    const debited = BigInt(30) * CENT - GROSS * BigInt(60)
    expect(await balanceOf(t)).toBe(debited)
    // A top-up from before all of them arrives late: 61 rows would need
    // reading, above the limit of 50. Nothing is applied.
    const late = ev.deposited(READER, CENT, BigInt(31) * CENT, {
      ledger: LEDGER + 5,
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await ingest(t, late)
    expect(await balanceOf(t)).toBe(debited)
    expect((await account(t)).reconcileRequired).toMatchObject({
      eventId: late.id,
      ledger: LEDGER + 5,
    })
    expect(
      errors.mock.calls.some(([line]) =>
        String(line).includes('CHAIN_TAB_RECONCILE_REQUIRED')
      )
    ).toBe(true)
    // The indexer is not stuck on it, and a re-dispatch applies no part.
    const stored = await t.run(async (ctx) =>
      (await ctx.db.query('chainEvents').collect()).find(
        (e) => e.eventId === late.id
      )
    )
    expect(stored?.handled).toBe('done')
    await redispatchEvents(t, [late.id])
    expect(await balanceOf(t)).toBe(debited)
    // No tab tip until the balance is known again.
    expect(await errorCode(tip(t, s, { cents: 1 }))).toBe(
      'TAB_RECONCILE_PENDING'
    )
    expect(
      await t.query(internal.chain.tabReconcile.listReconcileRequired, {})
    ).toMatchObject([{ readerAddress: READER, eventId: late.id }])
    // The reconciliation sets the contract's balance and clears the mark.
    const truth = BigInt(31) * CENT - GROSS * BigInt(60)
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 100,
        balance: truth,
        paid: new Map(),
      })
    ).toMatchObject({ status: 'applied' })
    expect(await account(t)).toMatchObject({
      confirmedBalance: truth.toString(),
    })
    expect((await account(t)).reconcileRequired).toBeUndefined()
    expect(await debitRows(t)).toBe(0)
    await redispatchEvents(t)
    expect(await balanceOf(t)).toBe(truth)
    expect(await errorCode(tip(t, s, { cents: 1 }))).toBe('no error')
  })

  it('a newer absolute balance replaces one that could not be applied (#576)', async () => {
    vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', '50')
    const { t } = await opened(BigInt(30) * CENT, [])
    await ingestAll(
      t,
      Array.from({ length: 60 }, (_, i) => otherSettled(i, LEDGER + 10 + i))
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await ingest(
      t,
      ev.deposited(READER, CENT, BigInt(31) * CENT, { ledger: LEDGER + 5 })
    )
    expect((await account(t)).reconcileRequired).toBeDefined()
    const truth = BigInt(32) * CENT - GROSS * BigInt(60)
    await ingest(t, ev.deposited(READER, CENT, truth, { ledger: LEDGER + 200 }))
    expect(await balanceOf(t)).toBe(truth)
    expect((await account(t)).reconcileRequired).toBeUndefined()
  })

  it('at the read limit, a late balance still applies in full (#576)', async () => {
    vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', '50')
    const { t } = await opened(BigInt(30) * CENT, [])
    await ingestAll(
      t,
      Array.from({ length: 50 }, (_, i) => otherSettled(i, LEDGER + 10 + i))
    )
    await ingest(
      t,
      ev.deposited(READER, CENT, BigInt(31) * CENT, { ledger: LEDGER + 5 })
    )
    expect(await balanceOf(t)).toBe(BigInt(31) * CENT - GROSS * BigInt(50))
    expect((await account(t)).reconcileRequired).toBeUndefined()
  })

  it('one mutation shares its read budget across events, and a tab already marked reads no more (#576)', async () => {
    vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', '50')
    vi.stubEnv('TAB_DEBIT_READ_BUDGET', '80')
    const { t } = await opened(BigInt(30) * CENT, [])
    await ingestAll(
      t,
      Array.from({ length: 40 }, (_, i) => otherSettled(i, LEDGER + 10 + i))
    )
    const later = GROSS * BigInt(40)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Three late top-ups in one mutation, each with 40 later debits to read:
    // the first two use the budget of 80, the third finds none left and
    // applies nothing.
    const d1 = ev.deposited(READER, CENT, BigInt(31) * CENT, {
      ledger: LEDGER + 5,
    })
    const d2 = ev.deposited(READER, CENT, BigInt(32) * CENT, {
      ledger: LEDGER + 6,
    })
    const d3 = ev.deposited(READER, CENT, BigInt(33) * CENT, {
      ledger: LEDGER + 7,
    })
    await ingest(t, d1, d2, d3)
    expect(await balanceOf(t)).toBe(BigInt(32) * CENT - later)
    expect((await account(t)).reconcileRequired).toMatchObject({
      eventId: d3.id,
    })
    // A top-up older than the marked one: no read, no change.
    await ingest(
      t,
      ev.deposited(READER, CENT, BigInt(40) * CENT, { ledger: LEDGER + 6 })
    )
    expect(await balanceOf(t)).toBe(BigInt(32) * CENT - later)
    expect((await account(t)).reconcileRequired?.eventId).toBe(d3.id)
    // A newer balance clears the mark; a re-dispatch of everything in one
    // mutation then reads within its budget and changes nothing.
    const truth = BigInt(34) * CENT - later
    await ingest(t, ev.deposited(READER, CENT, truth, { ledger: LEDGER + 100 }))
    expect(await balanceOf(t)).toBe(truth)
    expect((await account(t)).reconcileRequired).toBeUndefined()
    await redispatchEvents(t)
    expect(await balanceOf(t)).toBe(truth)
    expect((await account(t)).reconcileRequired).toBeUndefined()
  })

  it('long runs: thousands of settlements between rare balances, delivered out of order, re-dispatched and replayed (#576)', async () => {
    for (const seedNo of [11, 12, 13, 14]) {
      const rand = prng(seedNo)
      const pick = (n: number) => Math.floor(rand() * n)
      const t = convexTest(schema, modules)
      await seed(t)
      let balance = BigInt(10) * XLM
      let ledger = LEDGER
      let paid = BigInt(0)
      const queue: RawRpcEvent[] = []
      const indexed: RawRpcEvent[] = []
      let sinceBalance = 0
      let longest = 0
      for (let step = 0; step < 700; step++) {
        const op = pick(200)
        // About one balance event per 600 steps: runs well past 256 debits.
        if (op === 0 && pick(3) === 0) {
          const amount = BigInt(1 + pick(5)) * XLM
          balance += amount
          sinceBalance = 0
          queue.push(
            ev.deposited(READER, amount, balance, { ledger: ++ledger })
          )
        } else if (op < 170) {
          const gross = BigInt(1 + pick(5000))
          if (gross > balance) continue
          balance -= gross
          paid += gross
          sinceBalance++
          longest = Math.max(longest, sinceBalance)
          queue.push(
            ev.tabSettled(
              {
                writer: OTHER_WRITER,
                cumulative: paid,
                paidAfter: paid,
                gross,
              },
              { ledger: ++ledger }
            )
          )
        } else if (op < 190 && queue.length) {
          // Out of order within a window of the oldest 20.
          const [e] = queue.splice(pick(Math.min(20, queue.length)), 1)
          await ingest(t, e!)
          indexed.push(e!)
        } else if (op < 196 && indexed.length) {
          await redispatchEvents(t, [indexed[pick(indexed.length)]!.id])
        } else if (indexed.length) {
          await ingest(t, indexed[pick(indexed.length)]!)
        }
      }
      while (queue.length) {
        const [e] = queue.splice(pick(Math.min(20, queue.length)), 1)
        await ingest(t, e!)
      }
      expect(await balanceOf(t), `seed ${seedNo}`).toBe(balance)
      await redispatchEvents(t)
      expect(await balanceOf(t), `seed ${seedNo} after a replay`).toBe(balance)
      // Rows are kept only for debits after the newest balance.
      expect(await debitRows(t), `seed ${seedNo}`).toBeLessThanOrEqual(
        sinceBalance + 20
      )
      expect((await account(t)).settledSinceBalance).toEqual([])
      expect(longest, `seed ${seedNo}`).toBeGreaterThan(256)
    }
  }, 300_000)

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
      // Claims (#584): each writer's claimed total on chain.
      const claimed = new Map<string, bigint>()
      const userOf = (w: string) =>
        w === WRITER ? s.authorId : s.otherAuthorId
      const collected = async (w: string) =>
        BigInt(
          (await earnings(t, userOf(w)))?.collectedBaseUnits?.[TOKEN] ?? '0'
        )
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
        // A claim is never counted more than the chain made.
        for (const w of [WRITER, OTHER_WRITER]) {
          const got = await collected(w)
          if (got > (claimed.get(w) ?? BigInt(0))) {
            throw new Error(
              `seed ${seed}: collected ${got} > claimed ${claimed.get(w)}\n${trace.join('\n')}`
            )
          }
        }
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
        const op = pick(13)
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
        } else if (op === 11) {
          const w = [WRITER, OTHER_WRITER][pick(2)]!
          const amount = BigInt(1 + pick(100_000))
          claimed.set(w, (claimed.get(w) ?? BigInt(0)) + amount)
          queue.push(ev.claimed(w, amount, { ledger: ++chainLedger }))
          await check(`claim ${amount} ${w.slice(0, 4)}`)
        } else if (op === 12 && indexed.length) {
          // Every stored event back to pending, then dispatched again.
          await t.run(async (ctx) => {
            for (const row of await ctx.db.query('chainEvents').collect()) {
              await ctx.db.patch(row._id, { handled: 'pending' })
            }
          })
          for (;;) {
            const r = await t.mutation(internal.chain.indexer.redispatch, {
              limit: 500,
            })
            if (r.checked === 0) break
          }
          await check('redispatch all')
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
        for (const w of [WRITER, OTHER_WRITER]) {
          expect(await collected(w), `seed ${seed} claims`).toBe(
            claimed.get(w) ?? BigInt(0)
          )
        }
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
      // Every handler leaves the tables as they are on a full re-dispatch.
      await expectRedispatchChangesNothing(t)
      vi.restoreAllMocks()
    }
    console.info(
      `review property: worst lossy gap ${worstGap}; reconciliations ${JSON.stringify(results)}`
    )
  }, 600_000)

  // -------------------------------------------------------------------------
  // #584: each `Claimed` event changes collected earnings once.

  /** Every stored event back to `pending`, then dispatched again. */
  async function redispatchAll(t: T) {
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        await ctx.db.patch(row._id, { handled: 'pending' })
      }
    })
    for (;;) {
      const r = await t.mutation(internal.chain.indexer.redispatch, {
        limit: 500,
      })
      if (r.checked === 0) break
    }
  }
  const collectedOf = async (t: T, userId: Id<'users'>) =>
    (await earnings(t, userId))?.collectedBaseUnits?.[TOKEN] ?? '0'

  // Two writers' claims, before and after a snapshot point; totals as in a
  // restore rehearsal: 61,278,360 and 61,263,921 base units.
  const claimsOf = () => ({
    before: [
      ev.claimed(WRITER, BigInt(40_000_000), { ledger: LEDGER + 1 }),
      ev.claimed(OTHER_WRITER, BigInt(30_000_000), { ledger: LEDGER + 2 }),
    ],
    after: [
      ev.claimed(WRITER, BigInt(21_278_360), { ledger: LEDGER + 3 }),
      ev.claimed(OTHER_WRITER, BigInt(31_263_921), { ledger: LEDGER + 4 }),
    ],
  })

  it('every event back to pending and re-dispatched, a replay, a backfill and rebuilt rows: each claim counts once (#584)', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = claimsOf()
    await ingest(t, ...before)
    // Snapshot point.
    expect(await collectedOf(t, s.authorId)).toBe('40000000')
    await ingest(t, ...after)
    const expectTotals = async (step: string) => {
      expect(await collectedOf(t, s.authorId), step).toBe('61278360')
      expect(await collectedOf(t, s.otherAuthorId), step).toBe('61263921')
    }
    await expectTotals('indexed')
    await redispatchAll(t)
    await expectTotals('every event re-dispatched')
    await redispatchAll(t)
    await expectTotals('re-dispatched twice')
    await ingest(t, ...before, ...after)
    await expectTotals('replay and backfill')
    // Event rows rebuilt from RPC (a restore without them): same ids.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        if (row.type === 'claimed') await ctx.db.delete(row._id)
      }
    })
    await ingest(t, ...after, ...before)
    await expectTotals('rows rebuilt')
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query('tabClaims').collect()).length
      )
    ).toBe(4)
    await expectRedispatchChangesNothing(t)
  })

  it('a claim indexed before the settlement it follows (#584)', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const paid = paidOf(WRITER, 10)
    // Chain: settle at L+1, then the writer claims at L+2. The claim is
    // indexed first.
    await ingest(
      t,
      ev.claimed(WRITER, BigInt(9) * CENT, { ledger: LEDGER + 2 })
    )
    await settlerRecord(t, settlementId, [paid], LEDGER + 1)
    await ingest(t, settledEvent(paid, { ledger: LEDGER + 1 }))
    await redispatchAll(t)
    expect(await collectedOf(t, s.authorId)).toBe((BigInt(9) * CENT).toString())
    expect(await spendable(t, s)).toBe(BigInt(5) * CENT)
    await expectRedispatchChangesNothing(t)
  })

  it('rows written before the change: seeding ties existing totals to their events, and a recompute corrects a doubled total (#584)', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = claimsOf()
    await ingest(t, ...before, ...after)
    // As before this change: the totals applied, no records; and the totals
    // doubled by a re-dispatch, as a restore rehearsal found.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('tabClaims').collect()) {
        await ctx.db.delete(row._id)
      }
      for (const [userId, value] of [
        [s.authorId, '122556720'],
        [s.otherAuthorId, '122527842'],
      ] as const) {
        const row = (await ctx.db
          .query('authorEarnings')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .first())!
        await ctx.db.patch(row._id, {
          collectedBaseUnits: { [TOKEN]: value },
        })
      }
    })
    const seedRecords = (apply: boolean) =>
      t.mutation(internal.chain.tabClaims.seedClaimRecords, { apply })
    expect(await seedRecords(false)).toMatchObject({ seeded: 4, isDone: true })
    expect(
      await t.run(
        async (ctx) => (await ctx.db.query('tabClaims').collect()).length
      )
    ).toBe(0)
    expect(await seedRecords(true)).toMatchObject({ seeded: 4 })
    expect(await seedRecords(true)).toMatchObject({ seeded: 0 })
    // Seeding changes no total; a re-dispatch now adds nothing.
    expect(await collectedOf(t, s.authorId)).toBe('122556720')
    await redispatchAll(t)
    expect(await collectedOf(t, s.authorId)).toBe('122556720')
    // The recompute: dry run, then apply, with a record of each correction.
    const recompute = (apply: boolean) =>
      t.mutation(internal.chain.tabClaims.recomputeCollected, {
        apply,
        note: 'restore rehearsal',
      })
    const dry = await recompute(false)
    expect(dry).toMatchObject({ status: 'dry_run' })
    expect(
      dry.differences.map((d) => [d.before, d.after, d.claims]).sort()
    ).toEqual([
      ['122527842', '61263921', 2],
      ['122556720', '61278360', 2],
    ])
    expect(await collectedOf(t, s.authorId)).toBe('122556720')
    await recompute(true)
    expect(await collectedOf(t, s.authorId)).toBe('61278360')
    expect(await collectedOf(t, s.otherAuthorId)).toBe('61263921')
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query('tabClaimCorrections').collect()).length
      )
    ).toBe(2)
    expect((await recompute(true)).differences).toEqual([])
    // One writer alone.
    expect(
      await t.mutation(internal.chain.tabClaims.recomputeCollected, {
        userId: s.authorId,
      })
    ).toMatchObject({ checked: 1, differences: [] })
  })

  // -------------------------------------------------------------------------
  // Review attacks (#577): ledger order, lagging reads and reconciliation.

  /** Two pairs: 0.10 to WRITER and 0.10 to OTHER_WRITER on a 0.30 tab. */
  async function twoPairs() {
    const { t, s } = await opened(BigInt(30) * CENT, [10])
    await tip(t, s, { cents: 10, articleId: s.otherArticleId })
    const vs = await pairs(t)
    const idOf = (w: string) => vs.find((v) => v.writerAddress === w)!._id
    return { t, s, a: idOf(WRITER), b: idOf(OTHER_WRITER) }
  }

  it('review #577: a one-pair reconcile at a lagging ledger after a later debit is applied', async () => {
    const flagged = negatives()
    const { t, s, a, b } = await twoPairs()
    // Chain: A settles at L+1 (event lost), B settles at L+3 (indexed).
    const first = await beginSettlement(t, [a])
    await settlerRecord(t, first.settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    const second = await beginSettlement(t, [b])
    const pb = paidOf(OTHER_WRITER, 10)
    await settlerRecord(t, second.settlementId, [pb], LEDGER + 3)
    await ingest(t, settledEvent(pb, { ledger: LEDGER + 3 }))
    // Truth at L+3: balance 0.10, nothing owed: 0.10 spendable.
    const truth = BigInt(10) * CENT
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    // An RPC node two ledgers behind answers for ledger L+2: balance 0.20,
    // A paid 0.10. The operator reconciles pair A alone.
    const r = await reconcileAt(
      t,
      {
        ledger: LEDGER + 2,
        balance: BigInt(20) * CENT,
        paid: new Map([[WRITER, BigInt(10) * CENT]]),
      },
      { writer: WRITER }
    )
    // The read is older than B's applied debit: refused, nothing written.
    expect(r).toMatchObject({ status: 'refused', reason: 'STALE_READ' })
    expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  }, 30_000)

  /** Everything a release can change, for "nothing was written" checks. */
  async function ledgerState(t: T) {
    return t.run(async (ctx) => ({
      accounts: (await ctx.db.query('tabAccounts').collect()).map(
        ({ _creationTime, updatedAt, ...rest }) => rest
      ),
      vouchers: (await ctx.db.query('tabVouchers').collect()).map(
        ({ _creationTime, updatedAt, ...rest }) => rest
      ),
      releases: (await ctx.db.query('tabReserveReleases').collect()).length,
    }))
  }

  for (const order of ['deposit first', 'settlement first'] as const) {
    it(`review #577: a settlement and a deposit in one ledger, ${order}, event lost`, async () => {
      const flagged = negatives()
      const { t, s } = await opened(BigInt(15) * CENT, [10])
      const L = LEDGER + 5
      const p = paidOf(WRITER, 10)
      // Chain (one ledger, in this order): balance 0.15 → 0.05 → 0.25, or
      // 0.15 → 0.35 → 0.25. Either way 0.25 at the end of L, nothing owed.
      const deposit = ev.deposited(
        READER,
        BigInt(20) * CENT,
        order === 'deposit first' ? BigInt(35) * CENT : BigInt(25) * CENT,
        { ledger: L }
      )
      const { settlementId } = await beginSettlement(t)
      await settlerRecord(t, settlementId, [p], L)
      await ingest(t, deposit)
      const truth = BigInt(25) * CENT
      expect(await spendable(t, s)).toBeLessThanOrEqual(truth)
      // Same ledger: the release must wait (it cannot know the order).
      expect(await releases(t)).toHaveLength(0)
      await screenSums(t, s)
      // A later balance releases it, and the late event changes nothing.
      await ingest(
        t,
        ev.deposited(READER, CENT, BigInt(26) * CENT, { ledger: L + 1 })
      )
      expect(await spendable(t, s)).toBe(BigInt(26) * CENT)
      await ingest(t, settledEvent(p, { ledger: L }))
      expect(await spendable(t, s)).toBe(BigInt(26) * CENT)
      await screenSums(t, s)
      expect(flagged()).toEqual([])
    })
  }

  it('review #577: an older absolute balance delivered after the settler record releases nothing', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    // Chain: deposit 0.05 at L+2 (0.20), settlement at L+3 (0.10).
    const older = ev.deposited(READER, BigInt(5) * CENT, BigInt(20) * CENT, {
      ledger: LEDGER + 2,
    })
    await settlerRecord(t, settlementId, [p], LEDGER + 3)
    await ingest(t, older)
    // The L+2 balance does not include the L+3 debit: still held back.
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    expect(await releases(t)).toHaveLength(0)
    await ingest(t, settledEvent(p, { ledger: LEDGER + 3 }))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(10) * CENT).toString(),
      available: (BigInt(10) * CENT).toString(),
    })
  })

  it('review #577: a newer balance first, then an older one late: one release, exact figures', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    // Chain: settlement at L+3 (0.05), deposits at L+4 (0.10) and L+6 (0.15).
    await settlerRecord(t, settlementId, [p], LEDGER + 3)
    const d4 = ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
      ledger: LEDGER + 4,
    })
    const d6 = ev.deposited(READER, BigInt(5) * CENT, BigInt(15) * CENT, {
      ledger: LEDGER + 6,
    })
    await ingest(t, d6)
    await ingest(t, d4)
    await ingest(t, settledEvent(p, { ledger: LEDGER + 3 }))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(15) * CENT).toString(),
      available: (BigInt(15) * CENT).toString(),
    })
    expect(await releases(t)).toHaveLength(1)
  })

  it('review #577: a settler record whose ledger is unknown (0) releases nothing on an older balance', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    // Chain: deposit at L+2 (0.20), settlement at L+3 (0.10). The record
    // carries ledger 0; the indexer then delivers the L+2 deposit.
    await settlerRecord(t, settlementId, [p], 0)
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 2,
      })
    )
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(10) * CENT)
    expect(await releases(t)).toHaveLength(0)
    expect((await voucherRow(t)).paidLedger).toBeUndefined()
  })

  it('review #577: a reconcile at a ledger older than an applied debit refuses (reader-wide)', async () => {
    const { t, a, b } = await twoPairs()
    const first = await beginSettlement(t, [a])
    await settlerRecord(t, first.settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    const second = await beginSettlement(t, [b])
    const pb = paidOf(OTHER_WRITER, 10)
    await settlerRecord(t, second.settlementId, [pb], LEDGER + 3)
    await ingest(t, settledEvent(pb, { ledger: LEDGER + 3 }))
    const before = await ledgerState(t)
    const r = await reconcileAt(t, {
      ledger: LEDGER + 2,
      balance: BigInt(20) * CENT,
      paid: new Map([[WRITER, BigInt(10) * CENT]]),
    })
    expect(r).toMatchObject({ status: 'refused' })
    expect(await ledgerState(t)).toEqual(before)
  })

  it('review #577: nothing wrong, twice: nothing_to_do and nothing written', async () => {
    const { t } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [p], LEDGER + 1)
    await ingest(t, settledEvent(p, { ledger: LEDGER + 1 }))
    const before = await ledgerState(t)
    const read = {
      ledger: LEDGER + 2,
      balance: BigInt(5) * CENT,
      paid: new Map([[WRITER, BigInt(10) * CENT]]),
    }
    expect(await reconcileAt(t, read)).toMatchObject({
      status: 'nothing_to_do',
    })
    expect(await reconcileAt(t, read)).toMatchObject({
      status: 'nothing_to_do',
    })
    expect(await ledgerState(t)).toEqual(before)
  })

  it('review #577: restore with lost settlement events: reconcile, then a full replay and re-dispatch change nothing', async () => {
    const flagged = negatives()
    const { t, s, a, b } = await twoPairs()
    const all: RawRpcEvent[] = []
    const pa = paidOf(WRITER, 10)
    const pb = paidOf(OTHER_WRITER, 10)
    const first = await beginSettlement(t, [a])
    await settlerRecord(t, first.settlementId, [pa], LEDGER + 1)
    all.push(settledEvent(pa, { ledger: LEDGER + 1 }))
    const second = await beginSettlement(t, [b])
    await settlerRecord(t, second.settlementId, [pb], LEDGER + 2)
    all.push(settledEvent(pb, { ledger: LEDGER + 2 }))
    // Both events are missing (restore). Chain at L+3: 0.10, nothing owed.
    const r = await reconcileAt(t, {
      ledger: LEDGER + 3,
      balance: BigInt(10) * CENT,
      paid: new Map([
        [WRITER, BigInt(10) * CENT],
        [OTHER_WRITER, BigInt(10) * CENT],
      ]),
    })
    expect(r).toMatchObject({ status: 'applied' })
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    const fixed = await ledgerState(t)
    // A full replay of every event, then a re-dispatch of every stored one.
    await ingest(t, ...all)
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        await ctx.db.patch(row._id, { handled: 'pending' })
      }
    })
    await t.mutation(internal.chain.indexer.redispatch, {})
    const replayed = await ledgerState(t)
    expect(
      replayed.accounts.map((x) => [
        x.confirmedBalance,
        x.outstanding,
        x.settledUnindexed,
      ])
    ).toEqual(
      fixed.accounts.map((x) => [
        x.confirmedBalance,
        x.outstanding,
        x.settledUnindexed,
      ])
    )
    expect(replayed.releases).toBe(fixed.releases)
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    await screenSums(t, s)
    expect(flagged()).toEqual([])
  })

  it('review #577: restore with a lost deposit as well: the reconcile refuses, the replay makes it exact', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [p], LEDGER + 1)
    const lost = [
      settledEvent(p, { ledger: LEDGER + 1 }),
      ev.deposited(READER, BigInt(20) * CENT, BigInt(25) * CENT, {
        ledger: LEDGER + 2,
      }),
    ]
    const r = await reconcileAt(t, {
      ledger: LEDGER + 3,
      balance: BigInt(25) * CENT,
      paid: new Map([[WRITER, BigInt(10) * CENT]]),
    })
    expect(r).toMatchObject({ status: 'refused', reason: 'BALANCE_MISMATCH' })
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(25) * CENT)
    await ingest(t, ...lost)
    expect(await spendable(t, s)).toBe(BigInt(25) * CENT)
  })

  it('review #577: property with shared ledgers, lagging and one-pair reconciles, lost deposits', async () => {
    const SEEDS = Number(process.env.REVIEW_577_SEEDS ?? 60)
    const STEPS = Number(process.env.REVIEW_577_STEPS ?? 80)
    const tally: Record<string, number> = {}
    for (let seed = 9001; seed < 9001 + SEEDS; seed++) {
      const rand = prng(seed)
      const pick = (n: number) => Math.floor(rand() * n)
      const lossy = seed % 3 === 0
      const flagged = negatives()
      const initial = BigInt(20) * CENT
      const { t, s } = await opened(initial, [])
      const writers = [WRITER, OTHER_WRITER]
      const articleOf = (w: string) =>
        w === WRITER ? s.articleId : s.otherArticleId
      const m: ChainModel = {
        balance: initial,
        paid: new Map(),
        accepted: new Map(),
      }
      // Several transactions can share a ledger; ids follow creation order.
      let ledger = LEDGER
      // The latest ledger anything has read: it is closed, so new chain
      // actions land after it.
      let closed = LEDGER
      const nextLedger = () => {
        if (ledger <= closed || pick(2) === 0)
          ledger = Math.max(ledger, closed) + 1
        return ledger
      }
      const history: Array<{
        ledger: number
        balance: bigint
        paid: Map<string, bigint>
      }> = [{ ledger, balance: initial, paid: new Map() }]
      const snap = () =>
        history.push({ ledger, balance: m.balance, paid: new Map(m.paid) })
      const stateAt = (at: number) =>
        [...history].reverse().find((h) => h.ledger <= at)!
      const queue: RawRpcEvent[] = []
      const lost: RawRpcEvent[] = []
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
      const deliver = async (e: RawRpcEvent) => {
        closed = Math.max(closed, e.ledger)
        if (lossy && pick(4) === 0) {
          lost.push(e)
          return
        }
        await ingest(t, e)
      }
      for (let i = 0; i < STEPS; i++) {
        const op = pick(12)
        if (op <= 1) {
          const w = writers[pick(2)]!
          const cents = 1 + pick(6)
          const ok = await accepts(t, s, cents, articleOf(w))
          if (ok)
            m.accepted.set(
              w,
              (m.accepted.get(w) ?? BigInt(0)) + BigInt(cents) * CENT
            )
          await check(`tip ${cents} ${w.slice(0, 4)} ${ok}`)
        } else if (op === 2) {
          const amount = BigInt(1 + pick(8)) * CENT
          m.balance += amount
          queue.push(
            ev.deposited(READER, amount, m.balance, { ledger: nextLedger() })
          )
          snap()
          await check(`deposit ${amount} @${ledger}`)
        } else if (op === 3 && !record) {
          const ready = (await pairs(t)).filter(
            (v) => v.settleQueue === 'ready'
          )
          if (!ready.length) continue
          const { settlementId, vouchers } = await beginSettlement(t)
          const at = nextLedger()
          const outcomes: Outcome[] = []
          for (const v of vouchers) {
            const paid = m.paid.get(v.writerAddress) ?? BigInt(0)
            const cum = BigInt(v.cumulative)
            const delta = cum - paid
            const gross = delta < m.balance ? delta : m.balance
            if (delta <= BigInt(0) || gross <= BigInt(0)) {
              outcomes.push({
                kind: 'skipped',
                writer: v.writerAddress,
                cumulative: cum,
                reason: delta <= BigInt(0) ? 3 : 4,
              })
              continue
            }
            m.balance -= gross
            m.paid.set(v.writerAddress, paid + gross)
            const o = {
              kind: 'settled' as const,
              writer: v.writerAddress,
              cumulative: cum,
              paidAfter: paid + gross,
              gross,
            }
            outcomes.push(o)
            queue.push(settledEvent(o, { ledger: at }))
          }
          snap()
          record = { id: settlementId, outcomes, ledger: at }
          await check(`settle @${at}`)
        } else if (op === 4) {
          const w = writers[pick(2)]!
          const row = (await pairs(t)).find((v) => v.writerAddress === w)
          if (!row) continue
          const paid = m.paid.get(w) ?? BigInt(0)
          const cum = BigInt(row.cumulative)
          const delta = cum - paid
          const gross = delta < m.balance ? delta : m.balance
          if (delta <= BigInt(0) || gross <= BigInt(0)) continue
          m.balance -= gross
          m.paid.set(w, paid + gross)
          queue.push(
            settledEvent(
              {
                kind: 'settled',
                writer: w,
                cumulative: cum,
                paidAfter: paid + gross,
                gross,
              },
              { ledger: nextLedger() }
            )
          )
          snap()
          await check(`settle_own ${w.slice(0, 4)} @${ledger}`)
        } else if (op === 5 && record) {
          await settlerRecord(t, record.id, record.outcomes, record.ledger)
          record = null
          await check('record')
        } else if (op <= 7 && queue.length) {
          // In order most of the time; sometimes any queued event (late
          // absolute balances, settlements before deposits).
          const [e] = queue.splice(pick(3) === 0 ? pick(queue.length) : 0, 1)
          await deliver(e!)
          await check('index')
        } else if (op === 8) {
          // A reconcile, reader-wide or one pair, at the tip or at a
          // ledger a few behind (a lagging RPC node).
          const at =
            pick(3) === 0 ? Math.max(LEDGER, ledger - 1 - pick(3)) : ledger
          // A cursor at or past \`at\` means every event up to \`at\` was read
          // (or is lost for good); later ones may be indexed already.
          for (const e of queue.filter((q) => q.ledger <= at)) {
            queue.splice(queue.indexOf(e), 1)
            await deliver(e)
          }
          closed = Math.max(closed, at)
          const st = stateAt(at)
          const one = pick(2) === 0 ? writers[pick(2)] : undefined
          const r = await reconcileAt(
            t,
            { ledger: at, balance: st.balance, paid: st.paid },
            { apply: true, ...(one ? { writer: one } : {}) }
          )
          const key = r.status === 'refused' ? `refused ${r.reason}` : r.status
          tally[key] = (tally[key] ?? 0) + 1
          await check(
            `reconcile @${at}/${ledger} ${one ? one.slice(0, 4) : 'all'} ${key}`
          )
        } else if (op === 9) {
          await t.run(async (ctx) => {
            const rows = await ctx.db.query('chainEvents').collect()
            const row = rows[Math.floor(rand() * rows.length)]
            if (row) await ctx.db.patch(row._id, { handled: 'pending' })
          })
          await t.mutation(internal.chain.indexer.redispatch, {})
          await check('redispatch')
        }
      }
      if (record)
        await settlerRecord(t, record.id, record.outcomes, record.ledger)
      while (queue.length) await deliver(queue.shift()!)
      await check('drain')
      if (lossy) {
        const r = await reconcileAt(t, {
          ledger,
          balance: m.balance,
          paid: m.paid,
        })
        const key = `final ${r.status === 'refused' ? r.reason : r.status}`
        tally[key] = (tally[key] ?? 0) + 1
        await check(`final reconcile ${key}`)
        // The lost events arrive after all (a replay): exact afterwards.
        await ingest(t, ...lost)
        await check('replay lost')
      }
      const tab = await myTab(t, s)
      expect(BigInt(tab.available), `seed ${seed}\n${trace.join('\n')}`).toBe(
        chainSpendable(m)
      )
      expect(BigInt(tab.confirmedBalance), `seed ${seed}`).toBe(m.balance)
      expect(flagged(), `seed ${seed}`).toEqual([])
      vi.restoreAllMocks()
    }
    console.info(`review #577 property: ${JSON.stringify(tally)}`)
  }, 1_200_000)

  it('review #577: deposits at L and L+1 indexed after a reconcile at L', async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const p = paidOf(WRITER, 10)
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [p], LEDGER + 1)
    // Chain: settlement at L+1 (0.05), deposit at L+2 (0.10); both events
    // are missing when the operator reads at L+2.
    const atL = ev.deposited(READER, BigInt(5) * CENT, BigInt(10) * CENT, {
      ledger: LEDGER + 2,
    })
    const r = await reconcileAt(t, {
      ledger: LEDGER + 2,
      balance: BigInt(10) * CENT,
      paid: new Map([[WRITER, BigInt(10) * CENT]]),
    })
    // The deposit is missing too, so the stored 0.15 is above 0.10 by the
    // 0.10 payment minus the 0.05 deposit: explained, applied.
    expect(r).toMatchObject({ status: 'applied' })
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    // The L+2 deposit arrives late: already in the read balance.
    await ingest(t, atL)
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
    // A deposit at L+3 is newer than the reconciled balance.
    await ingest(
      t,
      ev.deposited(READER, BigInt(5) * CENT, BigInt(15) * CENT, {
        ledger: LEDGER + 3,
      })
    )
    expect(await spendable(t, s)).toBe(BigInt(15) * CENT)
    await ingest(t, settledEvent(p, { ledger: LEDGER + 1 }))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(15) * CENT).toString(),
      available: (BigInt(15) * CENT).toString(),
    })
    await screenSums(t, s)
  })

  it('review #577: a settlement that lands between the snapshot and the apply', async () => {
    const { t, s, a, b } = await twoPairs()
    const first = await beginSettlement(t, [a])
    await settlerRecord(t, first.settlementId, [paidOf(WRITER, 10)], LEDGER + 1)
    const snap = (await t.query(internal.chain.tabReconcile.snapshot, {
      reader: READER,
    }))!
    // After the snapshot: B's settlement begins and lands at L+2; its
    // record is not applied yet. The operator reads at L+3.
    const second = await beginSettlement(t, [b])
    const pb = paidOf(OTHER_WRITER, 10)
    await caughtUp(t, LEDGER + 3)
    const r = await t.mutation(internal.chain.tabReconcile.reconcile, {
      tabAccountId: snap.tabAccountId,
      digest: snap.digest,
      pairs: snap.pairs,
      chain: {
        ledger: LEDGER + 3,
        balance: (BigInt(10) * CENT).toString(),
        paid: snap.pairs.map((p) => ({
          ...p,
          paid: (BigInt(10) * CENT).toString(),
        })),
      },
      apply: true,
    })
    // \`begin\` does not change the figures the snapshot guards; the read
    // already shows B paid, so both pairs are applied at the read ledger.
    expect(r).toMatchObject({ status: 'applied' })
    expect(await spendable(t, s)).toBeLessThanOrEqual(BigInt(10) * CENT)
    await settlerRecord(t, second.settlementId, [pb], LEDGER + 2)
    await ingest(t, settledEvent(pb, { ledger: LEDGER + 2 }))
    await ingest(t, settledEvent(paidOf(WRITER, 10), { ledger: LEDGER + 1 }))
    expect(await myTab(t, s)).toMatchObject({
      confirmedBalance: (BigInt(10) * CENT).toString(),
      available: (BigInt(10) * CENT).toString(),
    })
    await screenSums(t, s)
  })

  // Writer lifetime totals (#552) on both settlement paths: one credit per
  // paid range, whichever path arrives first, equal to a rebuild.
  async function writerTotals(t: T, s: Seeded) {
    const row = (await ctx(t)).find((r) => r.userId === s.authorId)!
    return {
      tips: row.tabTipCount ?? 0,
      units: row.tabSettledBaseUnits?.[TOKEN] ?? '0',
      cents: row.tabEarnedCents ?? 0,
    }
  }
  const ctx = (t: T) =>
    t.run(async (c) => c.db.query('authorEarnings').collect())
  /** The pairs' paid net on chain: what the tab totals must equal. */
  async function chainPaid(t: T) {
    const net = (await pairs(t)).reduce(
      (sum, v) => sum + netOf(BigInt(v.paidOnChain)),
      BigInt(0)
    )
    return net.toString()
  }
  /** Rebuilds the writer's row from history and returns its tab totals. */
  async function rebuilt(t: T, s: Seeded) {
    await t.run(async (c) => {
      const row = (await c.db.query('authorEarnings').collect()).find(
        (r) => r.userId === s.authorId
      )!
      await c.db.patch(row._id, {
        tabTipCount: undefined,
        tabEarnedCents: undefined,
        tabSettledBaseUnits: undefined,
        walletEarnedBaseUnits: undefined,
        lifetimeTotalsAt: undefined,
        lifetimeRebuild: undefined,
      })
    })
    vi.stubEnv('EARNINGS_TOTALS_REBUILD_ENABLED', 'true')
    for (let i = 0; i < 20; i += 1) {
      const r = await t.action(internal.earningsTotalsBackfill.run, {})
      if (r.rebuilt + r.inProgress === 0) break
    }
    return writerTotals(t, s)
  }
  async function expectWriter(
    t: T,
    s: Seeded,
    f: { tips: number; units: string; cents: number }
  ) {
    expect(await writerTotals(t, s)).toEqual(f)
    expect(await chainPaid(t)).toBe(f.units)
  }

  for (const order of ['record first', 'event first'] as const) {
    it(`writer totals (#552): ${order}, each replayed, one credit, equal to a rebuild`, async () => {
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
      const once = { tips: 1, units: '975000', cents: 9.75 }
      if (order === 'record first') {
        await settlerRecord(t, settlementId, [paid])
        await expectWriter(t, s, once)
        await ingest(t, event)
      } else {
        await ingest(t, event)
        await expectWriter(t, s, once)
        await settlerRecord(t, settlementId, [paid])
      }
      await expectWriter(t, s, once)
      // Replays: the same event, the same report under a new id, the record.
      await ingest(t, event)
      await ingest(t, settledEvent(paid))
      await settlerRecord(t, settlementId, [paid])
      await expectWriter(t, s, once)
      expect(await rebuilt(t, s)).toEqual(once)
    })
  }

  it("writer totals (#552): the writer's settle_own with the settler's STALE skip counts once", async () => {
    const { t, s } = await opened(BigInt(15) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [
      {
        kind: 'skipped',
        writer: WRITER,
        cumulative: BigInt(10) * CENT,
        reason: 3,
      },
    ])
    // A STALE skip means the chain holds the payment: the record applies it,
    // and the writer's own event and its replay add nothing.
    const once = { tips: 1, units: '975000', cents: 9.75 }
    await expectWriter(t, s, once)
    const own = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await ingest(t, settledEvent(own))
    await ingest(t, settledEvent(own))
    await expectWriter(t, s, once)
    expect(await rebuilt(t, s)).toEqual(once)
  })

  it('writer totals (#552): a partial settler record, then the rest by event, counted by paid range', async () => {
    const { t, s } = await opened(BigInt(40) * CENT, [10, 25])
    const { settlementId } = await beginSettlement(t)
    // The settler paid 0.15 of 0.35 XLM: tip 1 in full, 0.05 of tip 2.
    const part = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(35) * CENT,
      paidAfter: BigInt(15) * CENT,
      gross: BigInt(15) * CENT,
    }
    await settlerRecord(t, settlementId, [part])
    const partial = { tips: 2, units: '1462500', cents: 14.625 }
    await expectWriter(t, s, partial)
    await ingest(t, settledEvent(part))
    await expectWriter(t, s, partial)
    expect(await rebuilt(t, s)).toEqual(partial)
    // The writer's settle_own pays the rest; its event arrives twice.
    const rest = settledEvent({
      kind: 'settled',
      writer: WRITER,
      cumulative: BigInt(35) * CENT,
      paidAfter: BigInt(35) * CENT,
      gross: BigInt(20) * CENT,
    })
    await ingest(t, rest)
    await ingest(t, rest)
    const full = { tips: 2, units: '3412500', cents: 34.125 }
    await expectWriter(t, s, full)
    expect(await rebuilt(t, s)).toEqual(full)
  })

  it('writer totals (#552): a pair written before indexedPaid, then new records and events', async () => {
    const { t, s } = await opened(BigInt(40) * CENT, [10])
    const { settlementId } = await beginSettlement(t)
    const first = {
      kind: 'settled' as const,
      writer: WRITER,
      cumulative: BigInt(10) * CENT,
      paidAfter: BigInt(10) * CENT,
      gross: BigInt(10) * CENT,
    }
    await settlerRecord(t, settlementId, [first])
    // As the old code left it: no indexed ranges, no reserve.
    await t.run(async (c) => {
      const a = await c.db.query('tabAccounts').first()
      await c.db.patch(a!._id, { settledUnindexed: undefined })
      for (const v of await c.db.query('tabVouchers').collect()) {
        await c.db.patch(v._id, { indexedPaid: undefined })
      }
    })
    expect(await rebuilt(t, s)).toEqual({
      tips: 1,
      units: '975000',
      cents: 9.75,
    })
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
    await ingest(t, settledEvent(second))
    await ingest(t, settledEvent(first))
    // netOf(0.15 XLM): 1,462,500; 9.75 + 4.875 cents.
    const both = { tips: 2, units: '1462500', cents: 14.625 }
    await expectWriter(t, s, both)
    expect(await rebuilt(t, s)).toEqual(both)
  })

  it('writer totals (#552): a rebuild of a pre-field pair reads its whole paidOnChain', async () => {
    const { t, s } = await opened(BigInt(40) * CENT, [10, 25])
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [
      {
        kind: 'settled',
        writer: WRITER,
        cumulative: BigInt(35) * CENT,
        paidAfter: BigInt(35) * CENT,
        gross: BigInt(35) * CENT,
      },
    ])
    await t.run(async (c) => {
      for (const v of await c.db.query('tabVouchers').collect()) {
        await c.db.patch(v._id, { indexedPaid: undefined })
      }
    })
    const pair = (await pairs(t))[0]!
    expect(pair.earnedNet).toBe(netOf(BigInt(pair.paidOnChain)).toString())
    expect(await rebuilt(t, s)).toEqual({
      tips: 2,
      units: netOf(BigInt(35) * CENT).toString(),
      cents: 34.125,
    })
  })

  // -------------------------------------------------------------------------
  // Review of #585: debit rows under a low read limit and a small budget.

  it('review #585: a balance between the marked one and a newer one not applied keeps the tab marked', async () => {
    vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', '4')
    vi.stubEnv('TAB_DEBIT_READ_BUDGET', '5')
    const { t } = await opened(BigInt(30) * CENT, [])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Settlements at +2, +3 and +6 to +8; top-ups at +1, +4 and +5,
    // indexed late.
    await ingestAll(
      t,
      [2, 3, 6, 7, 8].map((l, i) => otherSettled(i, LEDGER + l))
    )
    const debits = GROSS * BigInt(5)
    const top = (ledger: number, after: bigint) =>
      ev.deposited(READER, CENT, after, { ledger: LEDGER + ledger })
    const a = top(1, BigInt(31) * CENT)
    const b = top(4, BigInt(32) * CENT - GROSS * BigInt(2))
    const c = top(5, BigInt(33) * CENT - GROSS * BigInt(2))
    // One mutation: `a` has 5 later debits (over the limit of 4) and spends
    // the budget; `c` then finds no budget left. Neither applies.
    await ingest(t, a, c)
    const stored = BigInt(30) * CENT - debits
    expect(await balanceOf(t)).toBe(stored)
    expect((await account(t)).reconcileRequired?.eventId).toBe(c.id)
    // `b` is readable on its own (3 later debits), but `c` is newer: the
    // tab stays marked and the balance stays as it was.
    await ingest(t, b)
    expect(await balanceOf(t)).toBe(stored)
    expect((await account(t)).reconcileRequired?.eventId).toBe(c.id)
    const truth = BigInt(33) * CENT - debits
    expect(
      await reconcileAt(t, {
        ledger: LEDGER + 8,
        balance: truth,
        paid: new Map(),
      })
    ).toMatchObject({ status: 'applied' })
    expect(await balanceOf(t)).toBe(truth)
    expect((await account(t)).reconcileRequired).toBeUndefined()
  })

  it.each([
    [2, 3],
    [5, 1000],
    [1000, 1],
  ])(
    'review #585: property with a debit read limit of %i and a budget of %i: each balance applies in full or marks the tab, and the end is exact',
    async (scan, budget) => {
      const SEEDS = Number(process.env.REVIEW_585_SEEDS ?? 60)
      const STEPS = Number(process.env.REVIEW_585_STEPS ?? 100)
      let marksSeen = 0
      let reconciled = 0
      for (let seed585 = 1; seed585 <= SEEDS; seed585++) {
        vi.stubEnv('TAB_DEBIT_SCAN_LIMIT', String(scan))
        vi.stubEnv('TAB_DEBIT_READ_BUDGET', String(budget))
        const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
        const codes = (code: string) =>
          logs.mock.calls.filter(([line]) => {
            try {
              return JSON.parse(String(line)).code === code
            } catch {
              return false
            }
          }).length
        let r = seed585 * 7919 + scan * 31 + budget
        const pick = (n: number) => {
          r = (r * 1103515245 + 12345) % 2147483648
          return r % n
        }
        const t = convexTest(schema, modules)
        await seed(t, { open: false })
        let ledger = LEDGER
        let chain = BigInt(100) * XLM
        let paid = BigInt(0)
        const balanceAt = new Map<number, bigint>()
        // Balance points: an applied balance's event id and its value.
        const points = new Map<string, bigint>()
        const depositValue = new Map<string, bigint>()
        type Action = { raw: RawRpcEvent; gross?: bigint }
        const queue: Action[] = []
        const delivered: Action[] = []
        const first = ev.deposited(READER, chain, chain, { ledger })
        balanceAt.set(ledger, chain)
        points.set(first.id, chain)
        await ingest(t, first)
        delivered.push({ raw: first })
        let marked = false
        let markTransitions = 0
        const trace: string[] = []
        const check = async (label: string) => {
          trace.push(label)
          const acc = await account(t)
          const A = acc.balanceEventId!
          const base = points.get(A)
          const where = `seed ${seed585} (${scan}/${budget}) after ${label}\n${trace.slice(-12).join('\n')}`
          expect(base, where).toBeDefined()
          const debits = delivered
            .filter((a) => a.gross !== undefined && a.raw.id > A)
            .reduce((s, a) => s + a.gross!, BigInt(0))
          expect(BigInt(acc.confirmedBalance), where).toBe(base! - debits)
          const maxPoint = delivered
            .filter((a) => a.gross === undefined)
            .map((a) => a.raw.id)
            .reduce((m, id) => (id > m ? id : m), A)
          if (acc.reconcileRequired) {
            expect(acc.reconcileRequired.eventId > A, where).toBe(true)
            expect(
              delivered.some(
                (a) =>
                  a.gross !== undefined &&
                  a.raw.id > acc.reconcileRequired!.eventId
              ),
              where
            ).toBe(true)
            if (!marked) markTransitions++
            marked = true
            marksSeen++
          } else {
            // Every delivered balance is applied or older than the applied one.
            expect(A >= maxPoint, where).toBe(true)
            marked = false
          }
          expect(
            codes('CHAIN_TAB_RECONCILE_REQUIRED'),
            where
          ).toBeGreaterThanOrEqual(markTransitions)
          expect(codes('CHAIN_TAB_LEDGER_NEGATIVE'), where).toBe(0)
        }
        const deliver = async (actions: Action[]) => {
          await ingest(t, ...actions.map((a) => a.raw))
          for (const a of actions) {
            delivered.push(a)
            if (a.gross === undefined)
              points.set(a.raw.id, depositValue.get(a.raw.id)!)
          }
        }
        for (let step = 0; step < STEPS; step++) {
          // A marked tab is reconciled more often, so the run reaches it.
          const op = marked && pick(3) === 0 ? 99 : pick(100)
          if (op < 15) {
            const amount = BigInt(1 + pick(5)) * XLM
            chain += amount
            ledger++
            const raw = ev.deposited(READER, amount, chain, { ledger })
            depositValue.set(raw.id, chain)
            balanceAt.set(ledger, chain)
            queue.push({ raw })
            await check(`deposit ${amount} at ${ledger}`)
          } else if (op < 55) {
            const n = 1 + pick(4)
            for (let i = 0; i < n; i++) {
              const gross = BigInt(1000 + pick(4000))
              chain -= gross
              paid += gross
              ledger++
              balanceAt.set(ledger, chain)
              queue.push({
                raw: ev.tabSettled(
                  {
                    writer: OTHER_WRITER,
                    cumulative: paid,
                    paidAfter: paid,
                    gross,
                  },
                  { ledger }
                ),
                gross,
              })
            }
            await check(`${n} settlements to ${ledger}`)
          } else if (op < 80 && queue.length) {
            // Out of order inside a window of 20, in one mutation.
            const k = 1 + pick(Math.min(6, queue.length))
            const chosen: Action[] = []
            for (let i = 0; i < k && queue.length; i++) {
              chosen.push(queue.splice(pick(Math.min(20, queue.length)), 1)[0]!)
            }
            await deliver(chosen)
            await check(`deliver ${chosen.map((a) => a.raw.ledger).join(',')}`)
          } else if (op < 88 && delivered.length > 1) {
            const some = Array.from(
              { length: 1 + pick(3) },
              () => delivered[pick(delivered.length)]!.raw.id
            )
            const all = pick(3) === 0
            await t.run(async (ctx) => {
              for (const row of await ctx.db.query('chainEvents').collect()) {
                if (all || some.includes(row.eventId)) {
                  await ctx.db.patch(row._id, { handled: 'pending' })
                }
              }
            })
            for (;;) {
              const res = await t.mutation(internal.chain.indexer.redispatch, {
                limit: 500,
              })
              if (res.checked === 0 || res.resolved === 0) break
            }
            await check(all ? 'redispatch all' : 'redispatch some')
          } else if (op < 93 && delivered.length) {
            await ingest(
              t,
              ...Array.from(
                { length: 1 + pick(5) },
                () => delivered[pick(delivered.length)]!.raw
              )
            )
            await check('replay')
          } else if (op >= 93) {
            const result = await reconcileAt(t, {
              ledger,
              balance: chain,
              paid: new Map(),
            })
            if (result.status === 'applied') {
              points.set(
                (await account(t)).balanceEventId!,
                balanceAt.get(ledger)!
              )
              reconciled++
            } else if (marked) {
              throw new Error(
                `seed ${seed585}: marked tab not reconciled: ${JSON.stringify(result)}`
              )
            }
            await check(`reconcile at ${ledger}: ${result.status}`)
          }
        }
        // Drain, then a newer deposit: exact, and no mark left.
        while (queue.length) {
          const chosen = queue.splice(0, Math.min(queue.length, 1 + pick(10)))
          await deliver(chosen)
          await check('drain')
        }
        ledger++
        chain += XLM
        const last = ev.deposited(READER, XLM, chain, { ledger })
        depositValue.set(last.id, chain)
        await deliver([{ raw: last }])
        await check('final deposit')
        const acc = await account(t)
        expect(acc.reconcileRequired, `seed ${seed585}`).toBeUndefined()
        expect(acc.confirmedBalance, `seed ${seed585}`).toBe(chain.toString())
        await t.run(async (ctx) => {
          for (const row of await ctx.db.query('chainEvents').collect()) {
            await ctx.db.patch(row._id, { handled: 'pending' })
          }
        })
        for (;;) {
          const res = await t.mutation(internal.chain.indexer.redispatch, {
            limit: 500,
          })
          if (res.checked === 0 || res.resolved === 0) break
        }
        await ingest(t, ...delivered.map((a) => a.raw))
        expect((await account(t)).confirmedBalance, `seed ${seed585}`).toBe(
          chain.toString()
        )
        logs.mockRestore()
      }
      // The run reached the bounded path.
      expect(marksSeen).toBeGreaterThan(0)
      expect(reconciled).toBeGreaterThan(0)
    },
    900_000
  )

  // -------------------------------------------------------------------------
  // #616: a short payment parks the pair at once.

  /** Tab of 0.15 with 0.10 and 0.04 accepted, then 0.10 paid on another key. */
  async function overCommitted() {
    const { t, s } = await opened(BigInt(15) * CENT, [10, 4])
    await ingest(
      t,
      ev.tabSettled(
        {
          keyId: 1,
          writer: OTHER_WRITER,
          cumulative: BigInt(10) * CENT,
          paidAfter: BigInt(10) * CENT,
          gross: BigInt(10) * CENT,
        },
        { ledger: LEDGER + 2 }
      )
    )
    expect(await spendable(t, s)).toBe(-BigInt(9) * CENT)
    const pair = async () =>
      (await pairs(t)).find((v) => v.writerAddress === WRITER)!
    const earnings = () =>
      as(t, s.authorId).query(api.tabActivity.getMyTabEarnings, {})
    return { t, s, pair, earnings }
  }
  // The settler pays what is left: 0.05 of 0.14.
  const shortPayment = {
    kind: 'settled' as const,
    writer: WRITER,
    cumulative: BigInt(14) * CENT,
    paidAfter: BigInt(5) * CENT,
    gross: BigInt(5) * CENT,
  }

  it('a short payment parks the pair at once, counts it as short and is not selected again (#616)', async () => {
    const { t, s, pair, earnings } = await overCommitted()
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [shortPayment], LEDGER + 3)
    expect((await pair()).settleQueue).toBe('blocked')
    expect((await pair()).settlementId).toBeUndefined()
    expect(await receiptStatuses(t)).toEqual(['SHORTFALL', 'SHORTFALL'])
    const owedNet = netOf(BigInt(9) * CENT).toString()
    expect(await earnings()).toMatchObject({
      pendingNet: owedNet,
      shortfallPairs: 1,
      shortfallNet: owedNet,
      unpaidPairs: 0,
    })
    // However late, the settler spends no transaction on it.
    const later = await t.query(internal.tabSettlement.selectCandidates, {
      ledger: LEDGER + 3,
      now: T0 + 24 * 60 * 60 * 1000,
    })
    expect(later.candidates).toEqual([])
    await ingest(t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    expect((await pair()).settleQueue).toBe('blocked')
    // A deposit returns it to the queue; the old short event, dispatched
    // again, does not park it again.
    await ingest(
      t,
      ev.deposited(READER, BigInt(20) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 4,
      })
    )
    expect((await pair()).settleQueue).toBe('ready')
    await redispatchEvents(t)
    expect((await pair()).settleQueue).toBe('ready')
    // The rest settles.
    const next = await beginSettlement(t)
    const rest = {
      ...shortPayment,
      paidAfter: BigInt(14) * CENT,
      gross: BigInt(9) * CENT,
    }
    await settlerRecord(t, next.settlementId, [rest], LEDGER + 5)
    await ingest(t, settledEvent(rest, { ledger: LEDGER + 5 }))
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED'])
    expect((await pair()).settleQueue).toBe('done')
    expect(await earnings()).toMatchObject({
      pendingNet: '0',
      shortfallPairs: 0,
      shortfallNet: '0',
    })
    expect(await spendable(t, s)).toBe(BigInt(11) * CENT)
  })

  it('a short payment indexed first parks the pair, or leaves it to the record while it is in flight (#616)', async () => {
    // The writer's own `settle_own` pays what is left: no settler record.
    const first = await overCommitted()
    await ingest(first.t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    expect((await first.pair()).settleQueue).toBe('blocked')
    expect(await first.earnings()).toMatchObject({ shortfallPairs: 1 })

    // The event arrives while the settler's settlement is open.
    const second = await overCommitted()
    const { settlementId } = await beginSettlement(second.t)
    await ingest(second.t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    expect((await second.pair()).settleQueue).toBe('inflight')
    await settlerRecord(second.t, settlementId, [shortPayment], LEDGER + 3)
    expect((await second.pair()).settleQueue).toBe('blocked')
    expect((await second.pair()).settlementId).toBeUndefined()
  })

  it('a short payment does not park the pair when a newer deposit is already applied (#616)', async () => {
    const { t, s, pair, earnings } = await overCommitted()
    const { settlementId } = await beginSettlement(t)
    // A top-up at a later ledger is indexed before the settler's record and
    // before the settlement event.
    await ingest(
      t,
      ev.deposited(READER, BigInt(20) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 4,
      })
    )
    await settlerRecord(t, settlementId, [shortPayment], LEDGER + 3)
    expect((await pair()).settleQueue).toBe('ready')
    await ingest(t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    expect((await pair()).settleQueue).toBe('ready')
    expect(await earnings()).toMatchObject({ shortfallPairs: 0 })
    expect(await spendable(t, s)).toBe(BigInt(11) * CENT)
  })

  // Review of #619: delivery order, re-dispatch, replay and repeat short
  // payments.

  const settledShort = (paidAfter: number, gross: number) => ({
    ...shortPayment,
    paidAfter: BigInt(paidAfter) * CENT,
    gross: BigInt(gross) * CENT,
  })
  const selected = async (t: T) =>
    (
      await t.query(internal.tabSettlement.selectCandidates, {
        ledger: LEDGER + 10,
        now: T0 + 24 * 60 * 60 * 1000,
      })
    ).candidates.length

  it('review #619: a later deposit indexed before a settle_own short payment leaves the pair ready', async () => {
    const { t, s, pair, earnings } = await overCommitted()
    await ingest(
      t,
      ev.deposited(READER, BigInt(20) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 4,
      })
    )
    // The writer's own settlement, no settler record, from an older ledger.
    await ingest(t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    expect((await pair()).settleQueue).toBe('ready')
    expect(await earnings()).toMatchObject({ shortfallPairs: 0 })
    expect(await selected(t)).toBe(1)
    await redispatchEvents(t)
    expect((await pair()).settleQueue).toBe('ready')
    expect(await spendable(t, s)).toBe(BigInt(11) * CENT)
  })

  it('review #619: re-dispatch and replay of a short payment keep a parked pair parked and change no figure', async () => {
    const { t, s, pair, earnings } = await overCommitted()
    const { settlementId } = await beginSettlement(t)
    await settlerRecord(t, settlementId, [shortPayment], LEDGER + 3)
    await ingest(t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    const before = {
      pair: await pair(),
      earnings: await earnings(),
      spendable: await spendable(t, s),
      receipts: await receiptStatuses(t),
    }
    expect(before.pair.settleQueue).toBe('blocked')
    for (let round = 0; round < 2; round++) {
      await redispatchEvents(t)
      const after = await pair()
      expect(after.settleQueue).toBe('blocked')
      expect(after.paidOnChain).toBe(before.pair.paidOnChain)
      expect(await earnings()).toEqual(before.earnings)
      expect(await spendable(t, s)).toBe(before.spendable)
      expect(await receiptStatuses(t)).toEqual(before.receipts)
      expect(await selected(t)).toBe(0)
    }
  })

  it('review #619: a second short payment after a small deposit parks the pair again; the first one re-dispatched does not', async () => {
    const { t, s, pair, earnings } = await overCommitted()
    const first = await beginSettlement(t)
    await settlerRecord(t, first.settlementId, [shortPayment], LEDGER + 3)
    await ingest(t, settledEvent(shortPayment, { ledger: LEDGER + 3 }))
    // 0.02 XLM in: the pair returns to the queue and is paid 0.07 of 0.14.
    await ingest(
      t,
      ev.deposited(READER, BigInt(2) * CENT, BigInt(2) * CENT, {
        ledger: LEDGER + 4,
      })
    )
    expect((await pair()).settleQueue).toBe('ready')
    const second = await beginSettlement(t)
    expect(second.vouchers).toHaveLength(1)
    const again = settledShort(7, 2)
    // The event is indexed while the settlement is still open.
    await ingest(t, settledEvent(again, { ledger: LEDGER + 5 }))
    expect((await pair()).settleQueue).toBe('inflight')
    await settlerRecord(t, second.settlementId, [again], LEDGER + 5)
    expect(await pair()).toMatchObject({
      settleQueue: 'blocked',
      paidOnChain: (BigInt(7) * CENT).toString(),
    })
    expect((await pair()).settlementId).toBeUndefined()
    expect(await earnings()).toMatchObject({
      shortfallPairs: 1,
      shortfallNet: netOf(BigInt(7) * CENT).toString(),
    })
    // The older short payment, dispatched again, changes nothing.
    await redispatchEvents(t)
    expect((await pair()).settleQueue).toBe('blocked')
    expect(await selected(t)).toBe(0)
    // A larger deposit; the rest settles in full and stays settled on replay.
    await ingest(
      t,
      ev.deposited(READER, BigInt(20) * CENT, BigInt(20) * CENT, {
        ledger: LEDGER + 6,
      })
    )
    expect((await pair()).settleQueue).toBe('ready')
    const third = await beginSettlement(t)
    const rest = settledShort(14, 7)
    await settlerRecord(t, third.settlementId, [rest], LEDGER + 7)
    await ingest(t, settledEvent(rest, { ledger: LEDGER + 7 }))
    expect((await pair()).settleQueue).toBe('done')
    // A new tip after the full payment: the old short events, dispatched
    // again, do not park the new amount.
    await tip(t, s, { cents: 3 })
    expect((await pair()).settleQueue).toBe('ready')
    await redispatchEvents(t)
    expect((await pair()).settleQueue).toBe('ready')
    expect(await receiptStatuses(t)).toEqual(['SETTLED', 'SETTLED', 'ACCEPTED'])
    expect(await earnings()).toMatchObject({ shortfallPairs: 0 })
    expect(await spendable(t, s)).toBe(BigInt(10) * CENT)
  })

  it('review #619: only one settlement is open, and a pair that left it before the record is still parked', async () => {
    const { t, pair } = await overCommitted()
    const { settlementId } = await beginSettlement(t)
    // A second run cannot take the pair while the first is open.
    await expect(
      t.mutation(internal.tabSettlement.begin, {
        voucherIds: [(await pair())._id],
        cumulatives: [(await pair()).cumulative],
        submitter: READER,
        maxTime: Math.floor(Date.now() / 1000) + 300,
      })
    ).rejects.toThrow()
    // The pair leaves the settlement before the record arrives.
    await t.run(async (ctx) => {
      const v = (await ctx.db.query('tabVouchers').collect()).find(
        (row) => row.writerAddress === WRITER
      )!
      await ctx.db.patch(v._id, { settlementId: undefined })
    })
    await settlerRecord(t, settlementId, [shortPayment], LEDGER + 3)
    // The record still applies the payment and parks the pair.
    expect(await pair()).toMatchObject({
      settleQueue: 'blocked',
      paidOnChain: (BigInt(5) * CENT).toString(),
    })
    expect((await pair()).settlementId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Review of #596: each `Claimed` event changes collected earnings once.
// These tests use their own table comparison, not `./redispatch`.

describe('review #596: claims through re-dispatch, restore and seeding', () => {
  const collectedOf = async (t: T, userId: Id<'users'>) =>
    (await earnings(t, userId))?.collectedBaseUnits?.[TOKEN] ?? '0'
  const claimRows = (t: T) =>
    t.run(async (ctx) => ctx.db.query('tabClaims').collect())

  type Rows = Record<string, Record<string, Record<string, unknown>>>
  /** Every row of every table by id, with every field. */
  async function everyRow(t: T): Promise<Rows> {
    return t.run(async (ctx) => {
      const out: Rows = {}
      for (const name of Object.keys(schema.tables) as TableNames[]) {
        out[name] = {}
        for (const row of await ctx.db.query(name).collect()) {
          out[name]![String(row._id)] = { ...row }
        }
      }
      return out
    })
  }
  /** `everyRow` without `_creationTime` and `updatedAt`, for comparison. */
  const comparable = (rows: Rows) =>
    Object.fromEntries(
      Object.entries(rows).map(([name, byId]) => [
        name,
        Object.fromEntries(
          Object.entries(byId).map(([id, row]) => [
            id,
            Object.fromEntries(
              Object.entries(row).filter(
                ([k]) => k !== '_creationTime' && k !== 'updatedAt'
              )
            ),
          ])
        ),
      ])
    )

  /** Sets every stored event back to `pending` and dispatches all again. */
  async function forceRedispatch(t: T) {
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('chainEvents').collect()) {
        await ctx.db.patch(row._id, { handled: 'pending' })
      }
    })
    for (;;) {
      const r = await t.mutation(internal.chain.indexer.redispatch, {
        limit: 500,
      })
      if (r.checked === 0 || r.resolved === 0) break
    }
  }

  /**
   * Puts `tables` back as they were in `snapshot`, keeping ids (an import of
   * those tables from an export): rows added since are removed, changed rows
   * get their old fields back.
   */
  async function restore(t: T, snapshot: Rows, tables: TableNames[]) {
    await t.run(async (ctx) => {
      for (const name of tables) {
        const old = snapshot[name] ?? {}
        for (const row of await ctx.db.query(name).collect()) {
          const before = old[String(row._id)]
          if (!before) {
            await ctx.db.delete(row._id)
            continue
          }
          const fields = Object.fromEntries(
            Object.entries(before).filter(
              ([k]) => k !== '_id' && k !== '_creationTime'
            )
          )
          await ctx.db.replace(row._id, fields as never)
        }
        const kept = new Set(
          (await ctx.db.query(name).collect()).map((r) => String(r._id))
        )
        for (const id of Object.keys(old)) {
          if (!kept.has(id)) throw new Error(`${name} ${id} deleted since`)
        }
      }
    })
  }

  // The restore rehearsal's two writers, with two equal claims by one writer
  // and an amount shared by both writers.
  const rehearsalClaims = () => ({
    before: [
      ev.claimed(WRITER, BigInt(20_000_000), { ledger: LEDGER + 1 }),
      ev.claimed(OTHER_WRITER, BigInt(20_000_000), { ledger: LEDGER + 1 }),
      ev.claimed(WRITER, BigInt(20_000_000), { ledger: LEDGER + 2 }),
    ],
    after: [
      ev.claimed(OTHER_WRITER, BigInt(41_263_921), { ledger: LEDGER + 3 }),
      ev.claimed(WRITER, BigInt(21_278_360), { ledger: LEDGER + 4 }),
    ],
  })
  const expectRehearsalTotals = async (
    t: T,
    s: Seeded,
    step: string,
    totals: [string, string] = ['61278360', '61263921']
  ) => {
    expect(await collectedOf(t, s.authorId), step).toBe(totals[0])
    expect(await collectedOf(t, s.otherAuthorId), step).toBe(totals[1])
  }

  it('rehearsal case: every event forced back to pending and re-dispatched twice changes no table', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = rehearsalClaims()
    await ingest(t, ...before, ...after)
    await expectRehearsalTotals(t, s, 'indexed')
    const indexed = comparable(await everyRow(t))
    await forceRedispatch(t)
    // On the base commit: 122,556,720 and 122,527,842.
    await expectRehearsalTotals(t, s, 'first re-dispatch')
    await forceRedispatch(t)
    await expectRehearsalTotals(t, s, 'second re-dispatch')
    expect(comparable(await everyRow(t))).toEqual(indexed)
    expect((await claimRows(t)).length).toBe(5)
  })

  it('more than 256 claims by one writer: the oldest and a middle one rebuilt from RPC, then everything re-dispatched', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const claims = Array.from({ length: 300 }, (_, i) =>
      ev.claimed(WRITER, BigInt(1_000 + (i % 7)), {
        ledger: LEDGER + 1 + i,
      })
    )
    for (let i = 0; i < claims.length; i += 100) {
      await ingest(t, ...claims.slice(i, i + 100))
    }
    const total = claims
      .map((_, i) => BigInt(1_000 + (i % 7)))
      .reduce((a, b) => a + b)
      .toString()
    expect(await collectedOf(t, s.authorId)).toBe(total)
    const indexed = comparable(await everyRow(t))
    // The rows of the oldest and a middle claim are lost and read again.
    const lost = [claims[0]!, claims[150]!]
    await t.run(async (ctx) => {
      for (const raw of lost) {
        const row = await ctx.db
          .query('chainEvents')
          .withIndex('by_event_id', (q) => q.eq('eventId', raw.id))
          .first()
        await ctx.db.delete(row!._id)
      }
    })
    const reread = await ingest(t, ...lost)
    expect(reread.stored).toBe(2)
    expect(await collectedOf(t, s.authorId)).toBe(total)
    await forceRedispatch(t)
    await ingest(t, ...claims.slice(0, 100))
    expect(await collectedOf(t, s.authorId)).toBe(total)
    expect((await claimRows(t)).length).toBe(300)
    const recompute = await t.mutation(
      internal.chain.tabClaims.recomputeCollected,
      { userId: s.authorId }
    )
    expect(recompute.differences).toEqual([])
    // Only the two rebuilt event rows differ (new ids).
    const now = comparable(await everyRow(t))
    expect({ ...now, chainEvents: {} }).toEqual({
      ...indexed,
      chainEvents: {},
    })
  })

  it('a restore of the whole database to a snapshot, then the events replayed: each claim counts once', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = rehearsalClaims()
    await ingest(t, ...before)
    const snapshot = await everyRow(t)
    await ingest(t, ...after)
    await expectRehearsalTotals(t, s, 'before the restore')
    await restore(t, snapshot, Object.keys(schema.tables) as TableNames[])
    await expectRehearsalTotals(t, s, 'restored', ['40000000', '20000000'])
    // The indexer reads from the snapshot's cursor again, and an operator
    // backfills the whole range.
    await ingest(t, ...after)
    await ingest(t, ...before, ...after)
    await expectRehearsalTotals(t, s, 'replayed')
    await forceRedispatch(t)
    await expectRehearsalTotals(t, s, 'replayed and re-dispatched')
    expect((await claimRows(t)).length).toBe(5)
  })

  it('a restore that mixes exports: the recompute from the records gives the chain totals', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = rehearsalClaims()
    await ingest(t, ...before)
    const first = await everyRow(t)
    await ingest(t, ...after)
    const second = await everyRow(t)
    const recompute = (apply: boolean) =>
      t.mutation(internal.chain.tabClaims.recomputeCollected, {
        apply,
        note: 'review',
      })
    const rebuildEvents = async () => {
      await t.run(async (ctx) => {
        for (const row of await ctx.db.query('chainEvents').collect()) {
          await ctx.db.delete(row._id)
        }
      })
      await ingest(t, ...after, ...before)
    }

    // (a) Earnings from the first export, claim records and events from the
    // second: the later claims are recorded and never applied again.
    await restore(t, first, ['authorEarnings'])
    await expectRehearsalTotals(t, s, 'earnings older', [
      '40000000',
      '20000000',
    ])
    await forceRedispatch(t)
    await expectRehearsalTotals(t, s, 'earnings older, re-dispatched', [
      '40000000',
      '20000000',
    ])
    expect((await recompute(false)).differences.length).toBe(2)
    await recompute(true)
    await expectRehearsalTotals(t, s, '(a) recomputed')

    // (b) Event rows lost and rebuilt from RPC, earnings and records from
    // the second export: nothing is added.
    await restore(t, second, ['authorEarnings', 'tabClaims'])
    await rebuildEvents()
    await expectRehearsalTotals(t, s, '(b) events rebuilt')

    // (c) Claim records from the first export, earnings from the second,
    // event rows rebuilt: the later claims are applied a second time.
    await restore(t, second, ['authorEarnings'])
    await restore(t, first, ['tabClaims'])
    await rebuildEvents()
    await expectRehearsalTotals(t, s, '(c) records older', [
      (BigInt(61_278_360) + BigInt(21_278_360)).toString(),
      (BigInt(61_263_921) + BigInt(41_263_921)).toString(),
    ])
    // Seeding finds every claim recorded again; the recompute corrects.
    expect(
      await t.mutation(internal.chain.tabClaims.seedClaimRecords, {
        apply: true,
      })
    ).toMatchObject({ seeded: 0 })
    await recompute(true)
    await expectRehearsalTotals(t, s, '(c) recomputed')
    expect((await recompute(true)).differences).toEqual([])
  })

  it('migration: before seeding only a forced re-dispatch counts old claims again; seeding in pages around new claims ties them all', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = rehearsalClaims()
    await ingest(t, ...before, ...after)
    // As written before this change: totals applied, no records.
    const dropRecords = () =>
      t.run(async (ctx) => {
        for (const row of await ctx.db.query('tabClaims').collect()) {
          await ctx.db.delete(row._id)
        }
      })
    await dropRecords()
    const old = comparable(await everyRow(t))
    // The plain re-dispatch takes only pending rows: nothing changes.
    await t.mutation(internal.chain.indexer.redispatch, {})
    expect(comparable(await everyRow(t))).toEqual(old)
    // A dry run of either operation changes nothing.
    await t.mutation(internal.chain.tabClaims.seedClaimRecords, {})
    await t.mutation(internal.chain.tabClaims.recomputeCollected, {})
    expect(comparable(await everyRow(t))).toEqual(old)

    // Seeding one event per page, with a new claim indexed between pages.
    const later = [
      ev.claimed(WRITER, BigInt(1_000_000), { ledger: LEDGER + 10 }),
      ev.claimed(OTHER_WRITER, BigInt(2_000_000), { ledger: LEDGER + 11 }),
    ]
    let cursor: string | null = null
    let seeded = 0
    for (let page = 0; ; page++) {
      const r: {
        seeded: number
        isDone: boolean
        continueCursor: string | null
      } = await t.mutation(internal.chain.tabClaims.seedClaimRecords, {
        apply: true,
        cursor,
        limit: 1,
      })
      seeded += r.seeded
      if (page < later.length) await ingest(t, later[page]!)
      if (r.isDone) break
      cursor = r.continueCursor
    }
    expect(seeded).toBe(5)
    const sources = (await claimRows(t)).map((r) => r.source).sort()
    expect(sources).toEqual([
      'applied',
      'applied',
      'seeded',
      'seeded',
      'seeded',
      'seeded',
      'seeded',
    ])
    const totals: [string, string] = ['62278360', '63263921']
    await expectRehearsalTotals(t, s, 'seeded', totals)
    await forceRedispatch(t)
    await expectRehearsalTotals(t, s, 'seeded, re-dispatched', totals)
    expect(
      (await t.mutation(internal.chain.tabClaims.recomputeCollected, {}))
        .differences
    ).toEqual([])

    // Without seeding, the forced re-dispatch is the one way to count an
    // old claim again; the recompute then corrects it.
    await dropRecords()
    await forceRedispatch(t)
    await expectRehearsalTotals(t, s, 'not seeded, forced', [
      '124556720',
      '126527842',
    ])
    await t.mutation(internal.chain.tabClaims.recomputeCollected, {
      apply: true,
    })
    await expectRehearsalTotals(t, s, 'recomputed', totals)
  })

  it('a claim to an address verified only after its event is applied once, after the verification', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const LATE = seedAddress(43)
    const lateId = await t.run((ctx) =>
      ctx.db.insert('users', {
        username: 'late',
        email: 'late@example.test',
        stellarAddress: LATE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
    await ingest(t, ev.claimed(LATE, BigInt(7_000_000), { ledger: LEDGER + 1 }))
    expect(await collectedOf(t, lateId)).toBe('0')
    await t.run(async (ctx) => {
      await ctx.db.patch(lateId, {
        stellarAddressVerifiedAt: Date.now(),
        stellarAddressVerifiedNetwork: PASSPHRASE,
      })
    })
    // Seeding takes only applied (`done`) events, so the orphan stays open.
    expect(
      await t.mutation(internal.chain.tabClaims.seedClaimRecords, {
        apply: true,
      })
    ).toMatchObject({ seeded: 0 })
    await forceRedispatch(t)
    expect(await collectedOf(t, lateId)).toBe('7000000')
    await forceRedispatch(t)
    expect(await collectedOf(t, lateId)).toBe('7000000')
  })

  it('after a testnet reset, a claim with an id seen in the earlier epoch is a new claim', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const id = rpcEventId(LEDGER + 1, 900, 0, 0)
    await ingest(
      t,
      ev.claimed(WRITER, BigInt(3_000_000), { ledger: LEDGER + 1, id })
    )
    vi.stubEnv('CHAIN_EPOCH', 'testnet-tab-after-reset')
    await ingest(
      t,
      ev.claimed(WRITER, BigInt(5_000_000), { ledger: LEDGER + 1, id })
    )
    expect(await collectedOf(t, s.authorId)).toBe('8000000')
    expect((await claimRows(t)).map((r) => r.chainEpoch).sort()).toEqual([
      'testnet-tab',
      'testnet-tab-after-reset',
    ])
  })

  it('the operations are internal, and the earnings totals rebuild leaves collected and the lifetime totals as they were', async () => {
    const claimsModule = await import('../../convex/chain/tabClaims')
    for (const [name, fn] of Object.entries(claimsModule)) {
      expect(
        (fn as { isInternal?: boolean }).isInternal,
        `chain/tabClaims:${name}`
      ).toBe(true)
    }
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const { before, after } = rehearsalClaims()
    // Claims indexed before the settlement they follow, then two tab tips
    // settled on chain, then the later claims.
    await ingest(t, ...before)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_500_000),
        paidAfter: BigInt(3_500_000),
        gross: BigInt(3_500_000),
      })
    )
    await ingest(t, ...after)
    const row = (await earnings(t, s.authorId))!
    expect(row.tabSettledBaseUnits?.[TOKEN]).toBe(
      netOf(BigInt(3_500_000)).toString()
    )
    const live = comparable(await everyRow(t)).authorEarnings![
      String(row._id)
    ] as Record<string, unknown>
    // The rebuild runs on a row without lifetime totals.
    await t.run((ctx) => ctx.db.patch(row._id, { lifetimeTotalsAt: undefined }))
    for (let i = 0; i < 20; i++) {
      const r = await t.mutation(internal.earningsTotalsBackfill.rebuildStep, {
        id: row._id,
      })
      if (r === 'done') break
    }
    const rebuilt = comparable(await everyRow(t)).authorEarnings![
      String(row._id)
    ] as Record<string, unknown>
    expect(rebuilt.lifetimeTotalsAt).toBeTypeOf('number')
    expect({ ...rebuilt, lifetimeTotalsAt: 0 }).toEqual({
      ...live,
      lifetimeTotalsAt: 0,
    })
    await forceRedispatch(t)
    const redispatched = comparable(await everyRow(t)).authorEarnings![
      String(row._id)
    ] as Record<string, unknown>
    expect(redispatched).toEqual(rebuilt)
    expect(await collectedOf(t, s.authorId)).toBe('61278360')
  })
})

describe('adding money from the balance sheet', () => {
  it('prepares a first deposit with no device key', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    expect(await as(t, s.readerId).query(api.tabs.getMyTab, {})).toBeNull()
    await as(t, s.readerId).mutation(api.tabs.prepareDeposit, {
      amount: (BigInt(10) * XLM).toString(),
    })
    // Recorded, not on chain: the balance is not shown as open with zero.
    expect(await as(t, s.readerId).query(api.tabs.getMyTab, {})).toMatchObject({
      status: 'OPEN',
      confirmedBalance: '0',
      onChain: false,
      keys: [],
    })
    await ingest(t, ev.deposited(READER, BigInt(10) * XLM, BigInt(10) * XLM))
    expect(await as(t, s.readerId).query(api.tabs.getMyTab, {})).toMatchObject({
      onChain: true,
      confirmedBalance: '100000000',
      keys: [],
    })
    // A second prepare finds the account and adds nothing to it.
    await as(t, s.readerId).mutation(api.tabs.prepareDeposit, {
      amount: (BigInt(5) * XLM).toString(),
    })
    const accounts = await t.run((ctx) => ctx.db.query('tabAccounts').collect())
    expect(accounts).toHaveLength(1)
  })

  it('refuses a zero deposit before it records anything', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await expect(
      as(t, s.readerId).mutation(api.tabs.prepareDeposit, { amount: '0' })
    ).rejects.toThrow()
    const accounts = await t.run((ctx) => ctx.db.query('tabAccounts').collect())
    expect(accounts).toHaveLength(0)
  })

  it('tops up and registers a new device key in one call, leaving the other key alone', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const before = await as(t, s.readerId).query(api.tabs.getMyTab, {})
    expect(before?.keys).toHaveLength(1)
    await as(t, s.readerId).mutation(api.tabs.prepareOpen, {
      amount: (BigInt(10) * XLM).toString(),
      publicKey: SESSION_PUBLIC,
      validUntil: VALID_UNTIL,
      spendLimit: (BigInt(50) * XLM).toString(),
      extractable: false,
    })
    const balance = BigInt(before!.confirmedBalance) + BigInt(10) * XLM
    await ingest(
      t,
      ev.deposited(READER, BigInt(10) * XLM, balance),
      ev.keyRegistered(READER, 1)
    )
    const after = await as(t, s.readerId).query(api.tabs.getMyTab, {})
    expect(after?.confirmedBalance).toBe(balance.toString())
    expect(after?.keys.map((k) => k.keyId)).toEqual([0, 1])
    expect(after?.keys[0]).toEqual(before?.keys[0])
  })
})

describe('a first deposit with no device key: who may prepare it', () => {
  const amount = (BigInt(10) * XLM).toString()

  it('refuses a reader whose wallet is not verified on this network, and records nothing', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await t.run((ctx) =>
      ctx.db.patch(s.readerId, { stellarAddressVerifiedNetwork: 'other' })
    )
    expect(
      await errorCode(
        as(t, s.readerId).mutation(api.tabs.prepareDeposit, { amount })
      )
    ).toBe('TAB_READER_UNVERIFIED')
    await t.run((ctx) =>
      ctx.db.patch(s.readerId, { stellarAddressVerifiedAt: undefined })
    )
    expect(
      await errorCode(
        as(t, s.readerId).mutation(api.tabs.prepareDeposit, { amount })
      )
    ).toBe('TAB_READER_UNVERIFIED')
    expect(
      await t.run((ctx) => ctx.db.query('tabAccounts').collect())
    ).toHaveLength(0)
  })

  it('refuses an address whose balance belongs to another account', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    await as(t, s.readerId).mutation(api.tabs.prepareDeposit, { amount })
    // Another account that claims the same address.
    const intruder = await t.run((ctx) =>
      ctx.db.insert('users', {
        username: 'intruder',
        email: 'intruder@example.test',
        stellarAddress: READER,
        stellarAddressVerifiedAt: Date.now(),
        stellarAddressVerifiedNetwork: PASSPHRASE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
    expect(
      await errorCode(
        as(t, intruder).mutation(api.tabs.prepareDeposit, { amount })
      )
    ).toBe('TAB_ACCOUNT_OTHER_USER')
    const accounts = await t.run((ctx) => ctx.db.query('tabAccounts').collect())
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.userId).toBe(s.readerId)
  })

  it('refuses a signed-out caller', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { open: false })
    expect(
      await errorCode(t.mutation(api.tabs.prepareDeposit, { amount }))
    ).toBe('UNAUTHENTICATED')
  })
})
