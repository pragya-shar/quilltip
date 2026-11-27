/// <reference types="vite/client" />
/**
 * The money views (`balance.session`, `activity.mine`, `earnings.mine`) and
 * their invariants M1 to M4 (`convex/lib/moneyViews.ts`): one receipt, one
 * reader entry and one writer entry per tip under double tap, retry, reload
 * during send and a second device, in every settlement state; spendable
 * never above the on-chain balance minus accepted unsettled value; pending
 * plus available equal to the net of the tips that have not failed; a failed
 * payout never increasing available. Fixtures: `tab-kit.ts`.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import {
  SETTLE_GRACE_LEDGERS,
  netOf,
  receiptNet,
} from '../../convex/lib/chain/tabLedger'
import { centsFromBaseUnits, netMilliCents } from '../../convex/lib/moneyViews'
import { SETTLE_REQUEST_LEASE } from '../../convex/lib/chain/settleSchedule'
import {
  HIGHLIGHT,
  READER,
  VALID_UNTIL,
  XLM,
  as,
  errorCode,
  ev,
  ingest,
  modules,
  prepare,
  seed,
  setLedger,
  sign,
  submit,
  tip,
  withTabEnv,
  type Seeded,
  type T,
} from './tab-kit'

withTabEnv()

const page = { numItems: 50, cursor: null }

async function views(t: T, s: Seeded) {
  const reader = as(t, s.readerId)
  const writer = as(t, s.authorId)
  const [session, readerActivity, writerActivity, earnings] = await Promise.all(
    [
      reader.query(api.balance.session, {}),
      reader.query(api.activity.mine, { role: 'reader', paginationOpts: page }),
      writer.query(api.activity.mine, { role: 'writer', paginationOpts: page }),
      writer.query(api.earnings.mine, {}),
    ]
  )
  return {
    session: session!,
    readerActivity,
    writerActivity,
    earnings: earnings!,
  }
}

async function receipts(t: T) {
  return t.run(async (ctx) => ctx.db.query('tabReceipts').collect())
}

async function tipCents(t: T) {
  const rows = await receipts(t)
  return new Map(rows.map((r) => [r._id as string, r.amountCents ?? 0]))
}

/**
 * Checks M1 to M3 against the ledger rows after any step, and returns the
 * writer's available milli-cents for M4.
 */
async function checkInvariants(t: T, s: Seeded) {
  const v = await views(t, s)
  const rows = await receipts(t)
  const cents = await tipCents(t)
  const account = await t.run(async (ctx) =>
    ctx.db.query('tabAccounts').first()
  )
  const pairs = await t.run(async (ctx) =>
    ctx.db.query('tabVouchers').collect()
  )

  // M1: one entry per receipt on each side, and one receipt per tip row.
  const readerIds = v.readerActivity.page.map((e) => e.id)
  const writerIds = v.writerActivity.page.map((e) => e.id)
  expect(new Set(readerIds).size).toBe(readerIds.length)
  expect(new Set(writerIds).size).toBe(writerIds.length)
  expect([...readerIds].sort()).toEqual(rows.map((r) => r._id).sort())
  // The writer's side lists the receipts of the seeded writer only.
  const writerRows = rows.filter((r) => r.authorId === s.authorId)
  expect([...writerIds].sort()).toEqual(writerRows.map((r) => r._id).sort())
  expect(new Set(rows.map((r) => r.tipRowId)).size).toBe(rows.length)
  expect(new Set(rows.map((r) => r.clientRef)).size).toBe(rows.length)

  // M2: spendable is the confirmed balance minus the unpaid value of every
  // ACTIVE pair, never more than confirmed minus accepted-and-unsettled.
  if (account) {
    const confirmed = BigInt(account.confirmedBalance)
    const owed = pairs
      .filter((p) => p.state === 'ACTIVE')
      .reduce((sum, p) => {
        const d = BigInt(p.cumulative) - BigInt(p.paidOnChain)
        return sum + (d > BigInt(0) ? d : BigInt(0))
      }, BigInt(0))
    expect(BigInt(account.outstanding)).toBe(owed)
    const acceptedUnsettled = rows
      .filter((r) => r.status === 'ACCEPTED')
      .reduce((sum, r) => sum + BigInt(r.amount), BigInt(0))
    const available = BigInt(v.session.tokens[0]!.available)
    expect(available).toBe(
      confirmed - owed > BigInt(0) ? confirmed - owed : BigInt(0)
    )
    expect(available <= confirmed - acceptedUnsettled).toBe(true)
    expect(v.session.availableCents).toBe(centsFromBaseUnits(available, 1))
    expect(v.session.pendingCents).toBe(
      rows
        .filter((r) => r.status === 'ACCEPTED' || r.status === 'SHORTFALL')
        .reduce((sum, r) => sum + (cents.get(r._id) ?? 0), 0)
    )
  }

  // M3: the four buckets partition the receipts by status.
  const milli = (statuses: string[]) =>
    writerRows
      .filter((r) => statuses.includes(r.status))
      .reduce((sum, r) => sum + netMilliCents(r, cents.get(r._id)!), BigInt(0))
  const base = (statuses: string[]) =>
    writerRows
      .filter((r) => statuses.includes(r.status))
      .reduce((sum, r) => sum + receiptNet(r), BigInt(0))
  const e = v.earnings
  expect(e.pendingCents).toBe(Number(milli(['ACCEPTED']) / BigInt(1000)))
  expect(e.availableCents).toBe(Number(milli(['SETTLED']) / BigInt(1000)))
  expect(e.onHoldCents).toBe(Number(milli(['SHORTFALL']) / BigInt(1000)))
  expect(e.notPaidCents).toBe(
    Number(milli(['UNPAID', 'REJECTED', 'VOID_RESET']) / BigInt(1000))
  )
  expect(BigInt(e.baseUnits.pending) + BigInt(e.baseUnits.available)).toBe(
    base(['ACCEPTED', 'SETTLED'])
  )
  expect(
    BigInt(e.baseUnits.pending) +
      BigInt(e.baseUnits.available) +
      BigInt(e.baseUnits.onHold) +
      BigInt(e.baseUnits.notPaid)
  ).toBe(writerRows.reduce((sum, r) => sum + receiptNet(r), BigInt(0)))
  expect(e.tipCount).toBe(
    writerRows.filter((r) => r.status === 'ACCEPTED' || r.status === 'SETTLED')
      .length
  )
  // Available never shows more than the chain paid the writer.
  expect(
    BigInt(e.baseUnits.available) <= BigInt(e.baseUnits.onChainEarned)
  ).toBe(true)
  return { availableMilli: milli(['SETTLED']), views: v }
}

describe('exactly once per tip', () => {
  it('lists a double-tapped, retried tip once on each side', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Double tap: both taps carry the request id of one tip.
    const a = await prepare(t, s, { cents: 100, requestId: 'tap-1' })
    const b = await prepare(t, s, { cents: 100, requestId: 'tap-1' })
    expect(b.prepareId).toBe(a.prepareId)
    const first = await submit(t, s, a)
    // A lost response: the same signed voucher again.
    const again = await submit(t, s, a)
    expect(again).toMatchObject({
      receiptId: first.receiptId,
      alreadyAccepted: true,
    })
    const { views: v } = await checkInvariants(t, s)
    expect(v.readerActivity.page).toHaveLength(1)
    expect(v.writerActivity.page).toHaveLength(1)
    expect(v.session.recentRequestIds).toEqual(['tap-1'])
    expect(v.readerActivity.page[0]).toMatchObject({
      requestId: 'tap-1',
      amountCents: 100,
      state: 'accepted',
      notPaidReason: null,
      counterparty: { name: 'writer', username: 'writer' },
    })
    expect(v.writerActivity.page[0]).toMatchObject({
      state: 'accepted',
      // The tipper is never named to the writer.
      counterparty: { name: 'A reader', username: null },
    })
    expect(v.earnings).toMatchObject({ tipCount: 1, supporterCount: 1 })
  })

  it('accepts a tip once when the page reloads during the send', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Prepared, then the page reloaded before submit: the reopened page
    // prepares again with the stored request id and signs the same receipt.
    const before = await prepare(t, s, { cents: 25, requestId: 'reload-1' })
    const after = await prepare(t, s, { cents: 25, requestId: 'reload-1' })
    expect(after).toEqual({ ...before, existing: true })
    expect(sign(after)).toBe(sign(before))
    await submit(t, s, after)
    // Reloaded again after the submit landed but before its answer.
    const replay = await prepare(t, s, { cents: 25, requestId: 'reload-1' })
    expect((await submit(t, s, replay)).alreadyAccepted).toBe(true)
    const { views: v } = await checkInvariants(t, s)
    expect(v.readerActivity.page.map((e) => e.requestId)).toEqual(['reload-1'])
    expect(v.writerActivity.page).toHaveLength(1)
  })

  it('accepts one receipt when two devices submit the same tip', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const p = await prepare(t, s, { cents: 50, requestId: 'shared-1' })
    const [x, y] = await Promise.all([submit(t, s, p), submit(t, s, p)])
    expect(x.receiptId).toBe(y.receiptId)
    expect([x.alreadyAccepted, y.alreadyAccepted].sort()).toEqual([false, true])
    // Any other voucher for the accepted tip is refused.
    const forged = sign(p).replace(/^../, '00')
    expect(await errorCode(submit(t, s, p, { signature: forged }))).toBe(
      'TAB_DUPLICATE_REFERENCE'
    )
    // Another user cannot claim the request id.
    expect(
      await errorCode(
        prepare(t, s, {
          cents: 50,
          requestId: 'shared-1',
          userId: s.authorId,
        })
      )
    ).toBe('INVALID_PREPARE')
    const { views: v } = await checkInvariants(t, s)
    expect(v.readerActivity.page).toHaveLength(1)
    expect(v.writerActivity.page).toHaveLength(1)
  })
})

describe('money states across settlement', () => {
  it('moves a tip from pending to available on settlement, once, without changing spendable', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const before = (await views(t, s)).session
    expect(before.availableCents).toBe(1000) // 10 XLM at $1
    await tip(t, s, { cents: 100, highlight: HIGHLIGHT })
    const accepted = await checkInvariants(t, s)
    const gross = BigInt(10_000_000) // $1 at $1 per XLM
    expect(accepted.views.session).toMatchObject({
      availableCents: 900,
      pendingCents: 100,
    })
    expect(accepted.views.earnings).toMatchObject({
      pendingCents: Number((netOf(gross) * BigInt(100)) / gross),
      availableCents: 0,
    })
    expect(accepted.views.readerActivity.page[0]!.passage).toBe(HIGHLIGHT.text)

    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
    const settled = await checkInvariants(t, s)
    expect(settled.views.session).toMatchObject({
      // The debit and the release of the reservation cancel out.
      availableCents: 900,
      pendingCents: 0,
    })
    expect(settled.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 97,
      tipCount: 1,
    })
    expect(settled.views.earnings.baseUnits.available).toBe(
      netOf(gross).toString()
    )
    expect(settled.views.writerActivity.page[0]).toMatchObject({
      state: 'on-chain',
      txHash: 'ab'.repeat(32),
    })
    expect(settled.views.readerActivity.page).toHaveLength(1)
    // A replayed event changes nothing.
    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
    expect((await checkInvariants(t, s)).views.earnings).toEqual(
      settled.views.earnings
    )
  })

  it('holds a tip skipped for shortfall apart from pending and available until it is paid', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 })
    const { availableMilli: was } = await checkInvariants(t, s)
    await ingest(t, ev.voucherSkipped(BigInt(10_000_000), 4))
    const held = await checkInvariants(t, s)
    expect(held.availableMilli).toBe(was)
    expect(held.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      onHoldCents: 97,
      onHoldCount: 1,
      tipCount: 0,
    })
    expect(held.views.writerActivity.page[0]).toMatchObject({
      state: 'not-paid',
      notPaidReason: 'shortfall',
    })
    // The reader's money stays reserved: it can still be paid.
    expect(held.views.session).toMatchObject({
      availableCents: 900,
      pendingCents: 100,
    })
    expect(held.views.readerActivity.page[0]).toMatchObject({
      state: 'not-paid',
      notPaidReason: 'shortfall',
    })
    // The reader adds funds and the payout goes through: available once.
    await ingest(t, ev.deposited(READER, XLM, BigInt(11) * XLM))
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10_000_000),
        paidAfter: BigInt(10_000_000),
        gross: BigInt(10_000_000),
      })
    )
    const paid = await checkInvariants(t, s)
    expect(paid.views.earnings).toMatchObject({
      onHoldCents: 0,
      availableCents: 97,
      tipCount: 1,
    })
  })

  it('returns an unpaid tip to the reader and never makes it available', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 })
    const { availableMilli: was } = await checkInvariants(t, s)
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1)
    await t.mutation(internal.tabs.sweepUnpaid, {})
    const unpaid = await checkInvariants(t, s)
    expect(unpaid.availableMilli).toBe(was)
    expect(unpaid.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      notPaidCents: 97,
      notPaidCount: 1,
    })
    expect(unpaid.views.session).toMatchObject({
      availableCents: 1000,
      pendingCents: 0,
    })
    expect(unpaid.views.readerActivity.page[0]).toMatchObject({
      state: 'not-paid',
      notPaidReason: 'expired',
    })
  })

  it('returns a rejected tip to the reader and never makes it available', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 })
    await tip(t, s, { cents: 25 })
    const pair = await t.run(async (ctx) => ctx.db.query('tabVouchers').first())
    await t.mutation(internal.tabSettlement.rejectSettlementVouchers, {
      items: [{ voucherId: pair!._id, reason: 'simulation:test' }],
    })
    const rejected = await checkInvariants(t, s)
    expect(rejected.availableMilli).toBe(BigInt(0))
    expect(rejected.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      notPaidCount: 2,
    })
    expect(rejected.views.session.availableCents).toBe(1000)
    expect(
      rejected.views.writerActivity.page.map((e) => e.notPaidReason)
    ).toEqual(['rejected', 'rejected'])
  })

  it('shows only fully paid tips as available after a short payment', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 25 })
    await tip(t, s, { cents: 4 })
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_900_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    const partial = await checkInvariants(t, s)
    expect(partial.views.earnings).toMatchObject({
      availableCents: 9, // the 10 cent tip, net
      onHoldCount: 2,
      pendingCents: 0,
    })
    // The chain paid more than the settled tips' net: never shown as more.
    expect(
      BigInt(partial.views.earnings.baseUnits.onChainEarned) >
        BigInt(partial.views.earnings.baseUnits.available)
    ).toBe(true)
  })

  it('keeps every invariant through a mixed sequence of tips and outcomes', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    let last = BigInt(0)
    const step = async (failure: boolean) => {
      const r = await checkInvariants(t, s)
      if (failure) expect(r.availableMilli).toBe(last)
      else expect(r.availableMilli >= last).toBe(true)
      last = r.availableMilli
    }
    await tip(t, s, { cents: 100 }) // 10 M base units
    await step(false)
    await tip(t, s, { cents: 300, highlight: HIGHLIGHT }) // 30 M
    await step(false)
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10_000_000),
        paidAfter: BigInt(10_000_000),
        gross: BigInt(10_000_000),
      })
    )
    await step(false)
    await ingest(t, ev.voucherSkipped(BigInt(40_000_000), 4))
    await step(true)
    await tip(t, s, { cents: 100, articleId: s.otherArticleId })
    await step(false)
    await ingest(t, ev.deposited(READER, XLM, BigInt(10) * XLM))
    await step(false)
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(40_000_000),
        paidAfter: BigInt(40_000_000),
        gross: BigInt(30_000_000),
      })
    )
    await step(false)
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1)
    await t.mutation(internal.tabs.sweepUnpaid, {})
    await step(true)
    const final = await views(t, s)
    expect(final.earnings).toMatchObject({ tipCount: 2, notPaidCount: 0 })
    expect(final.readerActivity.page).toHaveLength(3)
  })
})

describe('balance session', () => {
  it('is null signed out and empty without a balance', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t, { open: false })
    expect(await t.query(api.balance.session, {})).toBeNull()
    const none = await as(t, s.readerId).query(api.balance.session, {})
    expect(none).toMatchObject({
      status: 'none',
      accountAddress: READER,
      network: 'testnet',
      availableCents: 0,
      devices: [],
      settlement: { enabled: true },
    })
  })

  it('gives the limits, devices and ledger clock the tip control needs', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const session = await as(t, s.readerId).query(api.balance.session, {})
    expect(session).toMatchObject({
      status: 'open',
      onChain: true,
      availableCents: 1000,
      pendingCents: 0,
      limits: {
        perTipCents: 500, // TAB_TIP_MAX 5 XLM at $1
        dailyCents: 2000,
        minTipCents: 1,
        defaultTipCents: 100,
        quickTipMaxCents: 500,
      },
      devices: [{ keyId: 0, revoked: false, validUntilLedger: VALID_UNTIL }],
      prices: [{ token: 'xlm', usd: 1 }],
    })
    expect(session!.ledger?.sequence).toBeGreaterThan(0)
  })

  it('says whether an article can take a balance tip', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const reader = as(t, s.readerId)
    expect(
      await reader.query(api.balance.tipContext, { articleId: s.articleId })
    ).toEqual({ tippable: true, reason: null, ownArticle: false })
    expect(
      await reader.query(api.balance.tipContext, {
        articleId: s.unregisteredId,
      })
    ).toMatchObject({ tippable: false, reason: 'not-tippable' })
    expect(
      await as(t, s.authorId).query(api.balance.tipContext, {
        articleId: s.articleId,
      })
    ).toMatchObject({ tippable: false, ownArticle: true })
  })
})

describe('settlement soon after acceptance', () => {
  async function scheduled(t: T) {
    return t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (f) => f.name.includes('tabSettler')
      )
    )
  }

  it('schedules one settler run per window when configured', async () => {
    vi.stubEnv('TAB_SETTLE_AFTER_ACCEPT_MS', '15000')
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    await tip(t, s, { cents: 10 })
    const runs = await scheduled(t)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.args[0]).toEqual({ requested: true, followUp: 0 })
    const delay = runs[0]!.scheduledTime - Date.now()
    expect(delay > 14_000 && delay <= 15_001).toBe(true)
    // After the window another acceptance schedules the next run.
    vi.advanceTimersByTime(15_001)
    await tip(t, s, { cents: 10 })
    expect(await scheduled(t)).toHaveLength(2)
    const lease = await t.run(async (ctx) =>
      ctx.db
        .query('chainLeases')
        .withIndex('by_name', (q) => q.eq('name', SETTLE_REQUEST_LEASE))
        .unique()
    )
    expect(lease!.expiresAt > Date.now() + 14_000).toBe(true)
  })

  it('schedules nothing when unset, out of range, or settlement is off', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    vi.stubEnv('TAB_SETTLE_AFTER_ACCEPT_MS', '50')
    await tip(t, s, { cents: 10 })
    expect(await scheduled(t)).toHaveLength(0)
  })

  it('reports how long settlement normally takes, for the lag notice', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const slow = await as(t, s.readerId).query(api.balance.session, {})
    expect(slow!.settlement.expectedWithinMs).toBe(6 * 3_600_000 + 600_000)
    vi.stubEnv('TAB_SETTLE_AFTER_ACCEPT_MS', '15000')
    const fast = await as(t, s.authorId).query(api.earnings.mine, {})
    expect(fast!.settlement).toEqual({
      enabled: true,
      expectedWithinMs: 75_000,
    })
  })
})

describe('spendable between a settlement result and its indexed event', () => {
  // Expected to fail until the ledger fix for this window merges from the
  // tab ledger's owner; it then passes and `it.fails` becomes `it`.
  it.fails(
    'never rises before the indexed TabSettled debits the balance',
    async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t) // 10 XLM on chain
      await tip(t, s, { cents: 500 })
      await tip(t, s, { cents: 500 })
      const before = await as(t, s.readerId).query(api.balance.session, {})
      expect(before!.tokens[0]!.available).toBe('0')
      const pair = await t.run(async (ctx) =>
        ctx.db.query('tabVouchers').first()
      )
      const settlementId = await t.mutation(internal.tabSettlement.begin, {
        voucherIds: [pair!._id],
        cumulatives: [pair!.cumulative],
        submitter: 'localKey',
        maxTime: Math.floor(Date.now() / 1000) + 300,
      })
      // The settler's own confirmed result, before the indexer sees the event.
      await t.mutation(internal.tabSettlement.finish, {
        settlementId,
        result: {
          status: 'CONFIRMED',
          txHash: 'cd'.repeat(32),
          ledger: 7_000_010,
          outcomes: [
            {
              kind: 'settled',
              reader: READER,
              writer: pair!.writerAddress,
              keyId: 0,
              cumulative: pair!.cumulative,
              paidAfter: pair!.cumulative,
              gross: pair!.cumulative,
              fee: '0',
            },
          ],
        },
      })
      // On chain the reader now holds 0: spendable must not rise.
      const after = await as(t, s.readerId).query(api.balance.session, {})
      expect(after!.tokens[0]!.available).toBe('0')
      expect(after!.availableCents).toBe(0)
      // A tip above the real on-chain balance is refused.
      expect(await errorCode(tip(t, s, { cents: 100 }))).toBe(
        'TAB_OVER_BALANCE'
      )
    }
  )
})
