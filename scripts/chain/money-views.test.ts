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
import type { Id } from '../../convex/_generated/dataModel'
import {
  SETTLE_GRACE_LEDGERS,
  netOf,
  paidPartOf,
  receiptNet,
} from '../../convex/lib/chain/tabLedger'
import { tabShareCents } from '../../convex/lib/authorEarnings'
import {
  reservedHeld,
  syncCollectedCents,
  syncPaidPart,
  unpaidCents,
} from '../../convex/lib/chain/balanceFigures'
import {
  centsFromBaseUnits,
  receiptShareCents,
} from '../../convex/lib/moneyViews'
import { SETTLE_REQUEST_LEASE } from '../../convex/lib/chain/settleSchedule'
import {
  RECOUNT_PAGE,
  resyncReaderPage,
} from '../../convex/lib/chain/balanceRecount'
import { RECENT_REQUESTS } from '../../convex/balance'
import { OWN_TIPS_ON_ARTICLE_LIMIT } from '../../convex/activity'
import {
  ACCEPTOR_PUBLIC,
  EPOCH,
  HIGHLIGHT,
  READER,
  TAB,
  TOKEN,
  WRITER,
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

/** Equal on the 1/10,000-cent grid of the running figures. */
function expectCents(actual: number, expected: number) {
  expect(Math.round(actual * 10_000)).toBe(Math.round(expected * 10_000))
}

/**
 * Checks M1 to M3 against the ledger rows after any step, and returns the
 * writer's available cents for M4.
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
  const paidOf = (r: (typeof rows)[number]) => {
    const pair = pairs.find(
      (p) =>
        p.tabAccountId === r.tabAccountId &&
        p.keyId === r.keyId &&
        p.writerAddress === r.writerAddress
    )
    return paidPartOf(r, BigInt(pair?.paidOnChain ?? '0'))
  }

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
  // Every receipt's money is applied to the running figures.
  expect(rows.every((r) => r.moneyAppliedStatus === r.status)).toBe(true)

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
    // The reader's pending: the unpaid part of every tip still reserved.
    expectCents(
      v.session.pendingCents,
      rows
        .filter((r) => r.status === 'ACCEPTED' || r.status === 'SHORTFALL')
        .reduce(
          (sum, r) =>
            sum +
            unpaidCents(
              cents.get(r._id) ?? 0,
              BigInt(r.amount),
              paidOf(r).gross
            ),
          0
        )
    )
  }

  // M3: what is paid on chain is settled (a tip paid in part counts its
  // paid part, #552); the rest of a tip is pending while accepted, on hold
  // while short, not paid once its pair closed. Pending, available and
  // collected sum to the tips that did not fail plus the paid parts of
  // those that did.
  const shareOf = (r: (typeof rows)[number]) =>
    receiptShareCents(r, cents.get(r._id)!)
  const paidShare = (r: (typeof rows)[number]) =>
    tabShareCents(cents.get(r._id)!, paidOf(r).net, BigInt(r.amount))
  const sumOf = (
    statuses: string[] | null,
    pick: (r: (typeof rows)[number]) => number
  ) =>
    writerRows
      .filter((r) => !statuses || statuses.includes(r.status))
      .reduce((sum, r) => sum + pick(r), 0)
  const e = v.earnings
  expectCents(e.pendingCents, sumOf(['ACCEPTED'], shareOf))
  expectCents(e.figures.settledCents, sumOf(null, paidShare))
  expectCents(
    e.availableCents + e.figures.tabCollectedCents,
    sumOf(null, paidShare)
  )
  expectCents(
    e.onHoldCents,
    sumOf(['SHORTFALL'], (r) => shareOf(r) - paidShare(r))
  )
  expectCents(
    e.notPaidCents,
    sumOf(
      ['UNPAID', 'REJECTED', 'VOID_RESET'],
      (r) => shareOf(r) - paidShare(r)
    )
  )
  expectCents(
    e.pendingCents + e.availableCents + e.collectedCents,
    sumOf(['ACCEPTED'], shareOf) +
      sumOf(null, paidShare) +
      e.figures.walletCents
  )
  expectCents(
    e.totalCents,
    e.pendingCents + e.availableCents + e.collectedCents
  )
  expect(e.pendingCount).toBe(
    writerRows.filter((r) => r.status === 'ACCEPTED').length
  )
  // A tip counts once, from its first paid part.
  expect(e.settledCount).toBe(
    writerRows.filter((r) => paidOf(r).net > BigInt(0)).length
  )
  // Base units: available is the paid net minus what was collected, the
  // same paid parts as the cents.
  const writerPairs = pairs.filter((p) => p.authorId === s.authorId)
  const settledBase = writerRows.reduce(
    (sum, r) => sum + paidOf(r).net,
    BigInt(0)
  )
  const ready = settledBase - BigInt(e.baseUnits.collected)
  expect(BigInt(e.baseUnits.available)).toBe(
    ready > BigInt(0) ? ready : BigInt(0)
  )
  expect(BigInt(e.baseUnits.pendingAndOnHold)).toBe(
    writerPairs.reduce((sum, p) => sum + BigInt(p.pendingNet), BigInt(0))
  )
  return { available: e.availableCents, views: v }
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
    expect(v.earnings).toMatchObject({ pendingCount: 1, settledCount: 0 })
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

describe('what each side is told', () => {
  it('states each tip’s fee and unpaid part, so no screen subtracts', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 25 }) // 2.5 M base units
    const entry = async (role: 'reader' | 'writer') =>
      (
        await as(t, role === 'reader' ? s.readerId : s.authorId).query(
          api.activity.mine,
          { role, paginationOpts: page }
        )
      ).page[0]!
    expect(await entry('writer')).toMatchObject({
      amountCents: 25,
      netCents: 24.375,
      feeCents: 0.625,
      paidCents: 0,
      unpaidCents: 25,
      unpaidNetCents: 24.375,
    })
    // Paid for 0.5 M of 2.5 M: a fifth.
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(2_500_000),
        paidAfter: BigInt(500_000),
        gross: BigInt(500_000),
      })
    )
    expect(await entry('writer')).toMatchObject({
      feeCents: 0.625,
      paidCents: 5,
      paidNetCents: 4.875,
      unpaidCents: 20,
      unpaidNetCents: 19.5,
    })
    expect(await entry('reader')).toMatchObject({
      paidCents: 5,
      unpaidCents: 20,
    })
  })

  it('places a tip on hold for shortfall: reserved for the reader, on hold for the writer, ready for neither', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t) // 10 XLM on chain
    await tip(t, s, { cents: 100 })
    await ingest(t, ev.voucherSkipped(BigInt(10_000_000), 4))
    const v = (await checkInvariants(t, s)).views
    // The reader: inside pending (still reserved), never in spendable.
    expect(v.session).toMatchObject({ pendingCents: 100, availableCents: 900 })
    expect(v.readerActivity.page[0]).toMatchObject({
      state: 'not-paid',
      notPaidReason: 'shortfall',
      unpaidCents: 100,
    })
    // The writer: neither on its way nor ready; on hold, with its count.
    expect(v.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      onHoldCents: 97.5,
      onHoldCount: 1,
    })
    expect(v.writerActivity.page[0]).toMatchObject({
      state: 'not-paid',
      notPaidReason: 'shortfall',
      unpaidNetCents: 97.5,
    })
  })

  it('offers a signed-out visitor public tip terms only', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const terms = await t.query(api.balance.publicTipTerms, {})
    // The same terms a signed-in reader's limits use, without an account.
    const limits = (await as(t, s.readerId).query(api.balance.session, {}))!
      .limits!
    expect(terms).toEqual({
      perTipCents: limits.perTipCents,
      minTipCents: limits.minTipCents,
      quickTipMaxCents: limits.quickTipMaxCents,
      defaultTipCents: limits.defaultTipCents,
      priceUsd: expect.any(Number),
    })
    expect(Object.keys(terms!)).not.toContain('availableCents')
  })

  it('gives the oldest pending tip’s acceptance time, and none once paid', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const writer = as(t, s.authorId)
    expect((await writer.query(api.earnings.mine, {}))!.oldestPendingAt).toBe(
      null
    )
    await tip(t, s, { cents: 100 })
    await tip(t, s, { cents: 100 })
    const first = (await receipts(t)).reduce((a, r) =>
      r.acceptedAt < a.acceptedAt ? r : a
    )
    expect((await writer.query(api.earnings.mine, {}))!.oldestPendingAt).toBe(
      first.acceptedAt
    )
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(20_000_000),
        paidAfter: BigInt(20_000_000),
        gross: BigInt(20_000_000),
      })
    )
    expect((await writer.query(api.earnings.mine, {}))!.oldestPendingAt).toBe(
      null
    )
  })

  it('tells someone who never published or received a tip that they are not a writer', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const reader = await as(t, s.readerId).query(api.earnings.mine, {})
    expect(reader!.isWriter).toBe(false)
    const writer = await as(t, s.authorId).query(api.earnings.mine, {})
    expect(writer!.isWriter).toBe(true)
  })
})

describe("a reader's own tips on one article", () => {
  it('lists only the caller’s accepted and settled tips there, with the passage, bounded', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10, requestId: 'line-1', highlight: HIGHLIGHT })
    await tip(t, s, { cents: 25, requestId: 'article-1' })
    // Another article: not listed.
    await tip(t, s, { cents: 10, articleId: s.otherArticleId })
    // A rejected receipt on this article: not listed.
    await t.run(async (ctx) => {
      const first = (await ctx.db.query('tabReceipts').first())!
      await ctx.db.insert('tabReceipts', {
        ...(({ _id: _i, _creationTime: _c, ...rest }) => rest)(first),
        clientRef: 'f'.repeat(32),
        leafHash: 'f'.repeat(64),
        requestId: 'rejected-1',
        status: 'REJECTED',
        acceptedAt: first.acceptedAt + 1,
      })
    })

    const mine = await as(t, s.readerId).query(api.activity.mineOnArticle, {
      articleId: s.articleId,
    })
    expect(mine.complete).toBe(true)
    expect(mine.tips.map((x) => x.requestId).sort()).toEqual([
      'article-1',
      'line-1',
    ])
    const line = mine.tips.find((x) => x.requestId === 'line-1')!
    expect(line).toMatchObject({
      passage: HIGHLIGHT,
      amountCents: 10,
      state: 'accepted',
    })
    expect(
      mine.tips.find((x) => x.requestId === 'article-1')!.passage
    ).toBeNull()

    // The writer and a signed-out visitor see none of the reader's tips.
    for (const query of [
      as(t, s.authorId).query(api.activity.mineOnArticle, {
        articleId: s.articleId,
      }),
      t.query(api.activity.mineOnArticle, { articleId: s.articleId }),
    ])
      expect(await query).toEqual({ tips: [], complete: true })
  })

  it('says when there are more than it returns', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10, requestId: 'seed' })
    await t.run(async (ctx) => {
      const first = (await ctx.db.query('tabReceipts').first())!
      const { _id: _i, _creationTime: _c, ...rest } = first
      for (let i = 0; i < OWN_TIPS_ON_ARTICLE_LIMIT; i++)
        await ctx.db.insert('tabReceipts', {
          ...rest,
          clientRef: i.toString(16).padStart(32, '0'),
          leafHash: i.toString(16).padStart(64, '0'),
          requestId: `more-${i}`,
          acceptedAt: first.acceptedAt + i + 1,
        })
    })
    const mine = await as(t, s.readerId).query(api.activity.mineOnArticle, {
      articleId: s.articleId,
    })
    expect(mine.tips).toHaveLength(OWN_TIPS_ON_ARTICLE_LIMIT)
    expect(mine.complete).toBe(false)
    // Newest first.
    expect(mine.tips[0]!.requestId).toBe(
      `more-${OWN_TIPS_ON_ARTICLE_LIMIT - 1}`
    )
  })

  it('puts the article id on every activity entry', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 })
    const page = await as(t, s.readerId).query(api.activity.mine, {
      role: 'reader',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page[0]!.article.id).toBe(s.articleId)
  })
})

describe('a device asks about its own tips by request id', () => {
  it('answers for a tip older than the newest accepted ids, and only to its reader', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10, requestId: 'mine-oldest' })
    for (let i = 0; i < RECENT_REQUESTS; i++) await tip(t, s, { cents: 10 })
    const reader = as(t, s.readerId)
    const session = await reader.query(api.balance.session, {})
    expect(session!.recentRequestIds).toHaveLength(RECENT_REQUESTS)
    expect(session!.recentRequestIds).not.toContain('mine-oldest')
    expect(
      await reader.query(api.balance.acceptedRequests, {
        requestIds: ['mine-oldest', 'never-sent'],
      })
    ).toEqual(['mine-oldest'])
    // The writer is another user: it learns nothing about the reader's ids.
    expect(
      await as(t, s.authorId).query(api.balance.acceptedRequests, {
        requestIds: ['mine-oldest'],
      })
    ).toEqual([])
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
      pendingCents: 97.5, // $1 less 2.5%
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
      availableCents: 97.5,
      collectedCents: 0,
      settledCount: 1,
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
    const { available: was } = await checkInvariants(t, s)
    await ingest(t, ev.voucherSkipped(BigInt(10_000_000), 4))
    const held = await checkInvariants(t, s)
    expect(held.available).toBe(was)
    expect(held.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      onHoldCents: 97.5,
      onHoldCount: 1,
      settledCount: 0,
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
      availableCents: 97.5,
      settledCount: 1,
    })
  })

  it('returns an unpaid tip to the reader and never makes it available', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 })
    const { available: was } = await checkInvariants(t, s)
    await setLedger(t, VALID_UNTIL + SETTLE_GRACE_LEDGERS + 1)
    await t.mutation(internal.tabs.sweepUnpaid, {})
    const unpaid = await checkInvariants(t, s)
    expect(unpaid.available).toBe(was)
    expect(unpaid.views.earnings).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      notPaidCents: 97.5,
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
    expect(rejected.available).toBe(0)
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

  it('counts the paid part of a short payment as ready and holds the rest, one tip each', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 10 }) // 1.0 M base units
    await tip(t, s, { cents: 25 }) // 2.5 M
    await tip(t, s, { cents: 4 }) // 0.4 M
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_900_000),
        paidAfter: BigInt(1_500_000),
        gross: BigInt(1_500_000),
      })
    )
    const partial = await checkInvariants(t, s)
    // The 10 cent tip is paid; the 25 cent tip is paid for 0.5 M of 2.5 M.
    // Ready: 9.75 + 24.375 x 1/5 = 14.625 cents, netOf(1.5 M) base units.
    // On hold: the rest of the 25 cent tip (19.5) and the 4 cent tip (3.9).
    expect(partial.views.earnings).toMatchObject({
      availableCents: 14.625,
      onHoldCents: 23.4,
      onHoldCount: 2,
      pendingCents: 0,
      settledCount: 2,
    })
    expect(partial.views.earnings.baseUnits.available).toBe(
      netOf(BigInt(1_500_000)).toString()
    )
    // The reader: the unpaid parts stay reserved (25 cents x 4/5, and 4).
    expect(partial.views.session!.pendingCents).toBe(24)
    // Paid in full later: all of it ready, nothing on hold, still two tips
    // plus the third.
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(3_900_000),
        paidAfter: BigInt(3_900_000),
        gross: BigInt(2_400_000),
      })
    )
    const full = await checkInvariants(t, s)
    expect(full.views.earnings).toMatchObject({
      onHoldCents: 0,
      onHoldCount: 0,
      pendingCents: 0,
      settledCount: 3,
      baseUnits: { available: netOf(BigInt(3_900_000)).toString() },
    })
    expectCents(full.views.earnings.availableCents, 9.75 + 24.375 + 3.9)
    expect(full.views.session!.pendingCents).toBe(0)
  })

  it('matches a collect seen before the last payment of a partly paid tip against what that payment paid', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 }) // 10 M
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10_000_000),
        paidAfter: BigInt(4_000_000),
        gross: BigInt(4_000_000),
      })
    )
    // The writer collects everything settled and more (the rest, early).
    await ingest(t, ev.claimed(WRITER, netOf(BigInt(10_000_000))))
    let e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({ availableCents: 0, collectedCents: 39 })
    expect(e.baseUnits.available).toBe('0')
    // The last payment settles the rest; the early collect covers exactly it.
    await ingest(
      t,
      ev.tabSettled({
        cumulative: BigInt(10_000_000),
        paidAfter: BigInt(10_000_000),
        gross: BigInt(6_000_000),
      })
    )
    e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({
      availableCents: 0,
      collectedCents: 97.5,
      onHoldCents: 0,
      pendingCents: 0,
    })
    expect(e.baseUnits.available).toBe('0')
  })

  it('keeps every invariant through a mixed sequence of tips and outcomes', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    let last = 0
    const step = async (failure: boolean) => {
      const r = await checkInvariants(t, s)
      if (failure) expect(r.available).toBe(last)
      else expect(r.available >= last).toBe(true)
      last = r.available
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
    expect(final.earnings).toMatchObject({ settledCount: 2, notPaidCount: 0 })
    expect(final.readerActivity.page).toHaveLength(3)
  })
})

describe('totals at any history length and across collects', () => {
  /**
   * 5,000 accepted tips over 20 pairs, written at the table level as
   * receipts accepted before the running figures existed, then brought in
   * by the backfill: the totals must be exact, with no cap.
   */
  async function longHistory(
    t: T,
    s: Seeded,
    { keys: KEYS = 20, perPair: PER_PAIR = 250 } = {}
  ) {
    await ingest(t, ev.deposited(READER, BigInt(990) * XLM, BigInt(1000) * XLM))
    for (let k = 1; k < KEYS; k++) await ingest(t, ev.keyRegistered(READER, k))
    // One real tip gives a tip row to point the rows at.
    await tip(t, s, { cents: 1, requestId: 'anchor' })
    return t.run(async (ctx) => {
      const account = (await ctx.db.query('tabAccounts').first())!
      const anchor = (await ctx.db.query('tabReceipts').first())!
      const anchorRow = (await ctx.db.get(anchor.tipRowId as Id<'tips'>))!
      // Each tip has its own row, as acceptance makes it.
      const tipRow = async (
        requestId: string,
        cents: number,
        amount: bigint
      ) => {
        const {
          _id: _ignoredId,
          _creationTime: _ignoredTime,
          earningsAppliedAt: _ignoredApplied,
          netBaseUnits: _ignoredNet,
          feeBaseUnits: _ignoredFee,
          ...rest
        } = anchorRow
        return ctx.db.insert('tips', {
          ...rest,
          requestId,
          clientRef: requestId.slice(0, 32),
          amountCents: cents,
          amountUsd: cents / 100,
          grossBaseUnits: amount.toString(),
          status: 'ACCEPTED',
        })
      }
      const now = Date.now()
      let outstanding = BigInt(account.outstanding)
      let expectedCents = 0
      let expectedShare = 0
      for (let k = 1; k < KEYS; k++) {
        let cumulative = BigInt(0)
        const leafHashes: string[] = []
        for (let seq = 1; seq <= PER_PAIR; seq++) {
          const cents = 1 + ((k + seq) % 5)
          const amount = BigInt(cents) * BigInt(100_000) // at $1 per XLM
          cumulative += amount
          outstanding += amount
          expectedCents += cents
          const leaf = (k * 1000 + seq).toString(16).padStart(64, '0')
          leafHashes.push(leaf)
          const r = {
            amount: amount.toString(),
            cumulativeAfter: cumulative.toString(),
          }
          expectedShare += tabShareCents(cents, receiptNet(r), amount)
          await ctx.db.insert('tabReceipts', {
            network: 'TESTNET',
            chainEpoch: EPOCH,
            tabAccountId: account._id,
            keyId: k,
            writerAddress: WRITER,
            authorId: s.authorId,
            articleId: s.articleId,
            articleKey: anchor.articleKey,
            seq,
            ...r,
            clientRef: leaf.slice(0, 32),
            contentHash: anchor.contentHash,
            leafHash: leaf,
            tipRowId: await tipRow(leaf, cents, amount),
            status: 'ACCEPTED',
            receiptsRoot: leaf,
            voucherSignature: anchor.voucherSignature,
            acceptorPublicKey: ACCEPTOR_PUBLIC,
            acceptanceSignature: anchor.acceptanceSignature,
            acceptedAt: now - k * 1000 - seq,
            amountCents: cents,
            createdAt: now,
            updatedAt: now,
          })
        }
        await ctx.db.insert('tabVouchers', {
          network: 'TESTNET',
          chainEpoch: EPOCH,
          tabAccountId: account._id,
          tabContractId: TAB,
          tokenContractId: TOKEN,
          readerAddress: READER,
          keyId: k,
          writerAddress: WRITER,
          authorId: s.authorId,
          cumulative: cumulative.toString(),
          receiptsRoot: leafHashes[leafHashes.length - 1]!,
          leafHashes,
          signature: anchor.voucherSignature,
          acceptance: {
            acceptor: ACCEPTOR_PUBLIC,
            signature: anchor.acceptanceSignature,
          },
          seq: PER_PAIR,
          paidOnChain: '0',
          unsettled: true,
          oldestUnsettledAt: now - k * 1000 - PER_PAIR,
          state: 'ACTIVE',
          settleBy: VALID_UNTIL + SETTLE_GRACE_LEDGERS,
          settleQueue: 'ready',
          earnedNet: '0',
          pendingNet: '0',
          acceptedAt: now,
          updatedAt: now,
        })
      }
      await ctx.db.patch(account._id, { outstanding: outstanding.toString() })
      return {
        keys: KEYS,
        perPair: PER_PAIR,
        // Plus the anchor tip of 1 cent.
        reservedCents: expectedCents + 1,
        share: expectedShare,
      }
    })
  }

  it('keeps exact totals for 5,000 tips on both sides, after a backfill', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const h = await longHistory(t, s)
    await t.mutation(internal.balanceBackfill.start, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    // Running the backfill again changes nothing.
    const once = await views(t, s)
    await t.mutation(internal.balanceBackfill.start, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const twice = await views(t, s)
    expect(twice.earnings).toEqual(once.earnings)
    expect(twice.session.pendingCents).toBe(once.session.pendingCents)

    const anchorShare = tabShareCents(1, BigInt(97_500), BigInt(100_000))
    expect(once.session.pendingCents).toBe(h.reservedCents)
    expect(once.earnings.pendingCount).toBe((h.keys - 1) * h.perPair + 1)
    expectCents(once.earnings.pendingCents, h.share + anchorShare)

    // Settle half the pairs: the totals move exactly, once.
    let settledShare = 0
    const rows = await receipts(t)
    for (let k = 1; k <= 10; k++) {
      const pair = rows.filter((r) => r.keyId === k)
      const cumulative = BigInt(pair[pair.length - 1]!.cumulativeAfter)
      settledShare += pair.reduce(
        (sum, r) => sum + receiptShareCents(r, r.amountCents!),
        0
      )
      await ingest(
        t,
        ev.tabSettled({
          keyId: k,
          cumulative,
          paidAfter: cumulative,
          gross: cumulative,
        })
      )
    }
    const after = await views(t, s)
    expectCents(after.earnings.availableCents, settledShare)
    expectCents(
      after.earnings.pendingCents + after.earnings.availableCents,
      h.share + anchorShare
    )
    expect(after.earnings.settledCount).toBe(10 * h.perPair)

    // The writer's list pages through every tip, once each.
    const seen = new Set<string>()
    let cursor: string | null = null
    for (;;) {
      const p: {
        page: { id: string }[]
        isDone: boolean
        continueCursor: string
      } = await as(t, s.authorId).query(api.activity.mine, {
        role: 'writer',
        paginationOpts: { numItems: 50, cursor },
      })
      for (const e of p.page) seen.add(e.id)
      if (p.isDone) break
      cursor = p.continueCursor
    }
    expect(seen.size).toBe((h.keys - 1) * h.perPair + 1)
  }, 120_000)

  it('pages a reader and a writer with many receipts, one mutation at a time, with settlements between pages', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Two pairs of 150 tips and the anchor: more than one page on each side.
    const h = await longHistory(t, s, { keys: 3, perPair: 150 })
    expect((h.keys - 1) * h.perPair + 1).toBeGreaterThan(RECOUNT_PAGE)
    const rows = await receipts(t)
    const shareOf = (k: number) =>
      rows
        .filter((r) => r.keyId === k)
        .reduce((sum, r) => sum + receiptShareCents(r, r.amountCents!), 0)
    const settle = (k: number) => {
      const pair = rows.filter((r) => r.keyId === k)
      const cumulative = BigInt(pair[pair.length - 1]!.cumulativeAfter)
      return ingest(
        t,
        ev.tabSettled({
          keyId: k,
          cumulative,
          paidAfter: cumulative,
          gross: cumulative,
        })
      )
    }
    const marked = () =>
      t.run(
        async (ctx) =>
          (await ctx.db.query('tabReceipts').collect()).filter(
            (r) => r.moneyAppliedStatus !== undefined
          ).length
      )
    const reservedMarked = () =>
      t.run(
        async (ctx) =>
          (await ctx.db.query('tabReceipts').collect()).filter(
            (r) => r.moneyReservedCents !== undefined
          ).length
      )
    // One scheduled mutation at a time, until `done` (bounded).
    const stepUntil = async (done: () => Promise<boolean>) => {
      for (let i = 0; !(await done()); i++) {
        if (i > 20) throw new Error('the backfill made no progress')
        vi.runOnlyPendingTimers()
        await t.finishInProgressScheduledFunctions()
      }
    }

    await t.mutation(internal.balanceBackfill.start, {})
    // The reader's first page of receipts, then a settlement of pair 2.
    await stepUntil(async () => (await reservedMarked()) > 1)
    // One page, plus the anchor tip that acceptance marked.
    expect(await reservedMarked()).toBe(RECOUNT_PAGE + 1)
    await settle(2)
    // The writer's first page, then a settlement of pair 1.
    await stepUntil(async () => (await marked()) > 1 + h.perPair)
    expect(await marked()).toBeLessThan(rows.length)
    await settle(1)
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const anchorShare = tabShareCents(1, BigInt(97_500), BigInt(100_000))
    const once = await views(t, s)
    // Only the anchor tip is still on its way, on both sides.
    expect(once.session.pendingCents).toBe(1)
    expect(once.earnings.pendingCount).toBe(1)
    expectCents(once.earnings.pendingCents, anchorShare)
    expect(once.earnings.settledCount).toBe(2 * h.perPair)
    expectCents(once.earnings.availableCents, shareOf(1) + shareOf(2))
    expect(
      (await receipts(t)).every((r) => r.moneyAppliedStatus === r.status)
    ).toBe(true)

    // Again, start to end: the same figures.
    await t.mutation(internal.balanceBackfill.start, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const twice = await views(t, s)
    expect(twice.earnings).toEqual(once.earnings)
    expect(twice.session.pendingCents).toBe(once.session.pendingCents)
  }, 120_000)

  it('leaves no reserve behind when a settlement lands between the reader and writer passes, in one run', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    // Five unmarked receipts on one pair and the anchor: one page each side.
    const h = await longHistory(t, s, { keys: 2, perPair: 5 })
    expect((h.keys - 1) * h.perPair + 1).toBeLessThan(RECOUNT_PAGE)
    const rows = await receipts(t)
    const pair = rows.filter((r) => r.keyId === 1)
    const cumulative = BigInt(pair[pair.length - 1]!.cumulativeAfter)

    await t.mutation(internal.balanceBackfill.start, {})
    // The reader's one-page recount, alone.
    vi.runOnlyPendingTimers()
    await t.finishInProgressScheduledFunctions()
    const afterReader = await t.run(
      async (ctx) => (await ctx.db.query('tabAccounts').first())!.reservedCents
    )
    expect(afterReader).toBe(h.reservedCents)
    // A settlement of the five lands before the writer pass.
    await ingest(
      t,
      ev.tabSettled({
        keyId: 1,
        cumulative,
        paidAfter: cumulative,
        gross: cumulative,
      })
    )
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    // One run is enough: only the anchor tip is still reserved, as a
    // recount from the receipts says.
    const once = await views(t, s)
    expect(once.session.pendingCents).toBe(1)
    const fromReceipts = (await receipts(t))
      .filter((r) => r.status === 'ACCEPTED' || r.status === 'SHORTFALL')
      .reduce((sum, r) => sum + r.amountCents!, 0)
    expect(once.session.pendingCents).toBe(fromReceipts)
    expect(
      (await receipts(t)).every((r) => r.moneyReservedCents !== undefined)
    ).toBe(true)
  })

  it('treats an unmarked, partly paid receipt as holding its whole cents on every path', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 }) // 10 M base units
    // As left by code that reserved before the markers existed: applied as
    // accepted, the whole tip reserved, no reserve marker, though the pair
    // had already paid 40% of it.
    const amount = BigInt(10_000_000)
    const paid = (gross: bigint) => ({ gross, net: netOf(gross) })
    const before = paid(BigInt(4_000_000))
    const after = paid(BigInt(6_000_000))
    const unmark = () =>
      t.run(async (ctx) => {
        const r = (await ctx.db.query('tabReceipts').first())!
        const { moneyReservedCents: _dropped, ...rest } = r
        await ctx.db.replace(r._id, { ...rest, moneyAppliedStatus: 'ACCEPTED' })
        await ctx.db.patch(r.tabAccountId, { reservedCents: 100 })
        return (await ctx.db.get(r._id))!
      })

    // The one rule, stated once.
    const unmarked = await unmark()
    expect(unmarked.moneyReservedCents).toBeUndefined()
    expect(reservedHeld(unmarked, 100)).toBe(100)

    // A further payment: what is left reserved is the unpaid part after it.
    await t.run(async (ctx) => {
      await syncPaidPart(ctx, unmarked, {
        amountCents: 100,
        before,
        after,
        token: TOKEN,
        now: Date.now(),
      })
    })
    const reservedAfterPayment = await t.run(
      async (ctx) => (await ctx.db.query('tabAccounts').first())!.reservedCents
    )
    expect(reservedAfterPayment).toBe(unpaidCents(100, amount, after.gross))

    // The paged recount reads the same receipt the same way: from the
    // whole cents to its unpaid part now.
    const again = await unmark()
    await t.run(async (ctx) => {
      await ctx.db.patch(again._id, { status: 'ACCEPTED' })
      const pair = (await ctx.db.query('tabVouchers').first())!
      await ctx.db.patch(pair._id, { paidOnChain: after.gross.toString() })
      await resyncReaderPage(ctx, again.tabAccountId, null, Date.now())
    })
    const reservedAfterPage = await t.run(
      async (ctx) => (await ctx.db.query('tabAccounts').first())!.reservedCents
    )
    expect(reservedAfterPage).toBe(reservedAfterPayment)
  })

  async function settleTwo(t: T, s: Seeded) {
    await tip(t, s, { cents: 100 }) // 10 M base units, 97.5 cents to the writer
    await tip(t, s, { cents: 300 }) // 30 M, 292.5 cents
    const gross = BigInt(40_000_000)
    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
    return netOf(gross)
  }

  it('moves a collect from available to collected once, and shows the same after reopen', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const net = await settleTwo(t, s)
    const before = (await checkInvariants(t, s)).views.earnings
    expect(before).toMatchObject({ availableCents: 390, collectedCents: 0 })
    const claim = ev.claimed(WRITER, net)
    await ingest(t, claim)
    const after = (await checkInvariants(t, s)).views.earnings
    expect(after).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      collectedCents: 390,
      totalCents: 390,
      baseUnits: { available: '0', collected: net.toString() },
    })
    // A replayed event and a reopened screen show the same three figures.
    await ingest(t, claim)
    const reopened = await as(t, s.authorId).query(api.earnings.mine, {})
    expect(reopened).toEqual(after)
  })

  // Inherited, not fixed here: issue 584. The `Claimed` handler adds to
  // `collectedBaseUnits` again when a stored event is processed a second
  // time (a restore re-queues it). Collected and ready figures are derived
  // from that field, so they inherit the double count: collected too high,
  // ready too low, never ready too high. Flips when the fix merges.
  it.fails(
    'a stored Claimed event processed twice collects once (issue 584)',
    async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const net = await settleTwo(t, s)
      const quarter = net / BigInt(4)
      await ingest(t, ev.claimed(WRITER, quarter))
      const once = await as(t, s.authorId).query(api.earnings.mine, {})
      expect(once).toMatchObject({
        collectedCents: 97.5,
        availableCents: 292.5,
      })
      // As after a restore: the stored event is queued and dispatched again.
      await t.run(async (ctx) => {
        const stored = (await ctx.db.query('chainEvents').collect()).filter(
          (e) => e.type.toLowerCase() === 'claimed'
        )
        expect(stored).toHaveLength(1)
        for (const e of stored)
          await ctx.db.patch(e._id, { handled: 'pending' })
      })
      await t.mutation(internal.chain.indexer.redispatch, {})
      const twice = await as(t, s.authorId).query(api.earnings.mine, {})
      expect(twice).toEqual(once)
    }
  )

  it('values a partial collect at the average cost of what is available', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const net = await settleTwo(t, s) // 39 M base units, 390 cents available
    const quarter = net / BigInt(4)
    await ingest(t, ev.claimed(WRITER, quarter))
    let e = (await checkInvariants(t, s)).views.earnings
    expect(e.collectedCents).toBe(97.5) // round(390 x 1/4)
    expect(e.availableCents).toBe(292.5)
    // The rest empties the base units and moves all remaining cents.
    await ingest(t, ev.claimed(WRITER, net - quarter))
    e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({ availableCents: 0, collectedCents: 390 })
  })

  // The running fields as on a deployment that predates them: settled
  // receipts and indexed collects, with neither the lifetime totals nor
  // the running figures of the balance screens yet.
  async function clearRunningFigures(t: T) {
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('authorEarnings').collect())
        await ctx.db.patch(row._id, {
          tabTipCount: undefined,
          tabEarnedCents: undefined,
          tabSettledBaseUnits: undefined,
          walletEarnedBaseUnits: undefined,
          lifetimeTotalsAt: undefined,
          lifetimeRebuild: undefined,
          lifetimeRebuildTurnAt: undefined,
          tabPendingCents: undefined,
          tabPendingCount: undefined,
          tabOnHoldCents: undefined,
          tabOnHoldCount: undefined,
          tabNotPaidCents: undefined,
          tabNotPaidCount: undefined,
          tabCollectedCents: undefined,
          tabMatchedBaseUnits: undefined,
          tabAheadBaseUnits: undefined,
          tabCollectedAppliedBaseUnits: undefined,
        })
      for (const r of await ctx.db.query('tabReceipts').collect())
        await ctx.db.patch(r._id, {
          moneyAppliedStatus: undefined,
          moneyAppliedCents: undefined,
          moneyReservedCents: undefined,
        })
      for (const a of await ctx.db.query('tabAccounts').collect())
        await ctx.db.patch(a._id, { reservedCents: undefined })
    })
  }

  /** The lifetime totals' rebuild (#552), to its end. */
  async function lifetimeRebuild(t: T) {
    // Only this switch: the tab kit's own environment stays as it is.
    process.env.EARNINGS_TOTALS_REBUILD_ENABLED = 'true'
    try {
      for (let i = 0; i < 100; i += 1) {
        const pending = await t.query(
          internal.earningsTotalsBackfill.pendingRows,
          { limit: 1 }
        )
        if (pending.length === 0) return
        await t.action(internal.earningsTotalsBackfill.run, {})
      }
      throw new Error('the lifetime rebuild did not finish')
    } finally {
      delete process.env.EARNINGS_TOTALS_REBUILD_ENABLED
    }
  }

  async function backfill(t: T) {
    await t.mutation(internal.balanceBackfill.start, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  }

  /** The order the backfills run in: the lifetime totals, then this one. */
  async function backfillInOrder(t: T) {
    await lifetimeRebuild(t)
    await backfill(t)
  }

  it('backfills settled and collected history, twice, and a later tip is ready, not collected', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const net = await settleTwo(t, s) // 400 cents, 39 M base units net
    await ingest(t, ev.claimed(WRITER, net))
    const live = await as(t, s.authorId).query(api.earnings.mine, {})
    expect(live).toMatchObject({ availableCents: 0, collectedCents: 390 })

    await clearRunningFigures(t)
    await backfillInOrder(t)
    const once = (await checkInvariants(t, s)).views.earnings
    expect(once).toEqual(live)
    // Either backfill again, in either order: the same figures.
    await backfill(t)
    await lifetimeRebuild(t)
    expect(await as(t, s.authorId).query(api.earnings.mine, {})).toEqual(live)

    // A new tip after the backfill: ready to withdraw, not collected.
    await tip(t, s, { cents: 100 })
    const before = BigInt(40_000_000)
    const after = BigInt(50_000_000)
    await ingest(
      t,
      ev.tabSettled({
        cumulative: after,
        paidAfter: after,
        gross: after - before,
      })
    )
    const e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({
      pendingCents: 0,
      availableCents: 97.5,
      collectedCents: 390,
      totalCents: 487.5,
      baseUnits: {
        available: (netOf(after) - netOf(before)).toString(),
        collected: net.toString(),
      },
    })
  })

  it('repairs collected figures a backfill without settled history left wrong', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const net = await settleTwo(t, s)
    await ingest(t, ev.claimed(WRITER, net))
    const live = await as(t, s.authorId).query(api.earnings.mine, {})
    // As left by the earlier backfill: settled history missing, the whole
    // collect held as ahead of it.
    await clearRunningFigures(t)
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query('tabReceipts').collect())
        await ctx.db.patch(r._id, { moneyAppliedStatus: r.status })
      const row = (await ctx.db.query('authorEarnings').collect()).find(
        (e) => e.userId === s.authorId
      )!
      await ctx.db.patch(row._id, {
        tabAheadBaseUnits: { [TOKEN]: net.toString() },
        tabMatchedBaseUnits: { [TOKEN]: '0' },
        tabCollectedAppliedBaseUnits: { [TOKEN]: net.toString() },
        tabCollectedCents: 0,
      })
    })
    await backfillInOrder(t)
    expect(await as(t, s.authorId).query(api.earnings.mine, {})).toEqual(live)
    await backfill(t)
    expect(await as(t, s.authorId).query(api.earnings.mine, {})).toEqual(live)
  })

  it('moves the same indexed collect once when its sync runs twice', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const net = await settleTwo(t, s)
    await ingest(t, ev.claimed(WRITER, net / BigInt(4)))
    const once = await as(t, s.authorId).query(api.earnings.mine, {})
    expect(once).toMatchObject({ collectedCents: 97.5, availableCents: 292.5 })
    // The same `Claimed` total applied again, past the indexer's event check.
    await t.run(async (ctx) => {
      await syncCollectedCents(ctx, s.authorId, TOKEN, Date.now())
      await syncCollectedCents(ctx, s.authorId, TOKEN, Date.now())
    })
    expect(await as(t, s.authorId).query(api.earnings.mine, {})).toEqual(once)
  })

  it('matches a collect indexed before the settlement that funded it', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await tip(t, s, { cents: 100 })
    const gross = BigInt(10_000_000)
    // The claim is indexed first: nothing is available to collect yet.
    await ingest(t, ev.claimed(WRITER, netOf(gross)))
    let e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({
      pendingCents: 97.5,
      availableCents: 0,
      collectedCents: 0,
    })
    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
    e = (await checkInvariants(t, s)).views.earnings
    expect(e).toMatchObject({
      pendingCents: 0,
      availableCents: 0,
      collectedCents: 97.5,
      totalCents: 97.5,
    })
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
  it('never rises when the indexed TabSettled arrives before the settler result', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t) // 10 XLM on chain
    await tip(t, s, { cents: 500 })
    await tip(t, s, { cents: 500 })
    const pair = await t.run(async (ctx) => ctx.db.query('tabVouchers').first())
    const settlementId = await t.mutation(internal.tabSettlement.begin, {
      voucherIds: [pair!._id],
      cumulatives: [pair!.cumulative],
      submitter: 'localKey',
      maxTime: Math.floor(Date.now() / 1000) + 300,
    })
    const gross = BigInt(pair!.cumulative)
    // The indexer sees the event first and debits the balance.
    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
    const mid = await as(t, s.readerId).query(api.balance.session, {})
    expect(mid!.tokens[0]!.available).toBe('0')
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
    const after = await as(t, s.readerId).query(api.balance.session, {})
    expect(after!.tokens[0]!.available).toBe('0')
    expect(await errorCode(tip(t, s, { cents: 100 }))).toBe('TAB_OVER_BALANCE')
  })

  // The ledger fix (settled amounts reserved until the balance event is
  // indexed) is merged: this now holds.
  it('never rises before the indexed TabSettled debits the balance', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t) // 10 XLM on chain
    await tip(t, s, { cents: 500 })
    await tip(t, s, { cents: 500 })
    const before = await as(t, s.readerId).query(api.balance.session, {})
    expect(before!.tokens[0]!.available).toBe('0')
    const pair = await t.run(async (ctx) => ctx.db.query('tabVouchers').first())
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
    expect(await errorCode(tip(t, s, { cents: 100 }))).toBe('TAB_OVER_BALANCE')
  })
})

describe('ready to collect counts balance tips only, in both units', () => {
  const WALLET_SHARE = BigInt(48_007_262_8) // a wallet tip's net, paid to the wallet
  const WALLET_CENTS = 536

  /** A wallet tip credited as the v2 earnings sync credits it. */
  async function walletTip(t: T, s: Seeded, with567: boolean) {
    await t.run(async (ctx) => {
      const row = await (
        await ctx.db.query('authorEarnings').collect()
      ).find((r) => r.userId === s.authorId)
      const base = {
        earnedBaseUnits: {
          ...row?.earnedBaseUnits,
          [TOKEN]: (
            BigInt(row?.earnedBaseUnits?.[TOKEN] ?? '0') + WALLET_SHARE
          ).toString(),
        },
        v2EarnedCents: (row?.v2EarnedCents ?? 0) + WALLET_CENTS,
        v2TipCount: (row?.v2TipCount ?? 0) + 1,
        totalEarnedCents: (row?.totalEarnedCents ?? 0) + WALLET_CENTS,
        ...(with567
          ? { walletEarnedBaseUnits: { [TOKEN]: WALLET_SHARE.toString() } }
          : {}),
      }
      if (row) await ctx.db.patch(row._id, base)
      else
        await ctx.db.insert('authorEarnings', {
          userId: s.authorId,
          totalEarnedUsd: 0,
          availableBalanceUsd: 0,
          availableBalanceCents: 0,
          pendingBalanceUsd: 0,
          pendingBalanceCents: 0,
          withdrawnUsd: 0,
          withdrawnCents: 0,
          tipCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...base,
        })
    })
  }
  async function balanceTips(t: T, s: Seeded) {
    await tip(t, s, { cents: 100 })
    await tip(t, s, { cents: 300 })
    const gross = BigInt(40_000_000)
    return { gross, net: netOf(gross) }
  }
  async function settle(t: T, gross: bigint) {
    await ingest(
      t,
      ev.tabSettled({ cumulative: gross, paidAfter: gross, gross })
    )
  }

  async function check(
    t: T,
    s: Seeded,
    expected: { readyBase: bigint; readyCents: number; with567?: boolean }
  ) {
    const e = (await as(t, s.authorId).query(api.earnings.mine, {}))!
    expect(BigInt(e.baseUnits.available)).toBe(expected.readyBase)
    expect(e.availableCents).toBe(expected.readyCents)
    // The same tips in both units: no token units means no cents, and
    // cents mean token units (a few units may round below a cent).
    if (e.baseUnits.available === '0') expect(e.availableCents).toBe(0)
    if (e.availableCents > 0)
      expect(BigInt(e.baseUnits.available) > BigInt(0)).toBe(true)
    // Lifetime = pending + ready + paid to the wallet.
    expectCents(
      e.totalCents,
      e.pendingCents + e.availableCents + e.collectedCents
    )
    // On a row that keeps the lifetime totals' wallet part, their formula
    // agrees. (On a row that predates them, the totals' live credit writes an
    // empty wallet part until the rebuild fills it: their formula does not
    // apply there yet, and ready above does not depend on it.)
    const row = await t.run(async (ctx) =>
      (await ctx.db.query('authorEarnings').collect()).find(
        (r) => r.userId === s.authorId
      )
    )
    if (expected.with567 && row?.walletEarnedBaseUnits) {
      const u = (r?: Record<string, string>) => BigInt(r?.[TOKEN] ?? '0')
      expect(
        u(row.earnedBaseUnits) -
          u(row.walletEarnedBaseUnits) -
          u(row.collectedBaseUnits)
      ).toBe(expected.readyBase)
    }
    return e
  }

  it('leaves one base unit after a claim: token amount shown, cents below one', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await walletTip(t, s, false)
    const { gross, net } = await balanceTips(t, s)
    await settle(t, gross)
    await ingest(t, ev.claimed(WRITER, net - BigInt(1)))
    const e = await check(t, s, { readyBase: BigInt(1), readyCents: 0 })
    expect(e.baseUnits.available).toBe('1')
  })

  for (const with567 of [false, true]) {
    const label = with567
      ? 'with the lifetime totals fields'
      : 'on a row that predates them'
    it(`wallet tips only: nothing ready (${label})`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await walletTip(t, s, with567)
      const e = await check(t, s, {
        readyBase: BigInt(0),
        readyCents: 0,
        with567,
      })
      expect(e.collectedCents).toBe(WALLET_CENTS)
    })
    it(`balance tips only (${label})`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      const { gross, net } = await balanceTips(t, s)
      await settle(t, gross)
      if (with567)
        await t.run(async (ctx) => {
          const row = (await (
            await ctx.db.query('authorEarnings').collect()
          ).find((r) => r.userId === s.authorId))!
          await ctx.db.patch(row._id, { walletEarnedBaseUnits: {} })
        })
      await check(t, s, { readyBase: net, readyCents: 390, with567 })
    })
    it(`wallet and balance tips (${label})`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await walletTip(t, s, with567)
      const { gross, net } = await balanceTips(t, s)
      await settle(t, gross)
      const e = await check(t, s, { readyBase: net, readyCents: 390, with567 })
      expect(e.collectedCents).toBe(WALLET_CENTS)
    })
    it(`wallet and balance tips with a partial claim (${label})`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await walletTip(t, s, with567)
      const { gross, net } = await balanceTips(t, s)
      await settle(t, gross)
      await ingest(t, ev.claimed(WRITER, net / BigInt(4)))
      const e = await check(t, s, {
        readyBase: net - net / BigInt(4),
        readyCents: 292.5,
      })
      expectCents(e.collectedCents, WALLET_CENTS + 97.5)
    })
    it(`wallet and balance tips with a claim before the settlement (${label})`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      await walletTip(t, s, with567)
      const { gross, net } = await balanceTips(t, s)
      await ingest(t, ev.claimed(WRITER, net))
      await settle(t, gross)
      const e = await check(t, s, {
        readyBase: BigInt(0),
        readyCents: 0,
        with567,
      })
      expectCents(e.collectedCents, WALLET_CENTS + 390)
    })
  }
})
