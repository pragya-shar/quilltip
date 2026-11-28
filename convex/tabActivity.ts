/**
 * Read models for the tab screens (issue #449): the reader's recent tab tips
 * with their receipt status, and the writer's tab earnings for the collect
 * panel. Read-only; every figure comes from the tab ledger, which only the
 * event indexer and the acceptance path write (convex/tabs.ts).
 *
 * Settlement health is reported so the UI can say when settlement is off or
 * late, using the same windows as the settler (03-tab-contract.md, sections
 * 3.7 and 3.8): a pair is due 6 h after its oldest receipt, and a pair whose
 * key settle window ends within 2 days is urgent.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { query, type QueryCtx } from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { DAY_LEDGERS, tabAccountForReader } from './lib/chain/tabLedger'
import { verifiedStellarAddress } from './lib/walletVerification'

/** The settler alerts while unsettled value is this close to its window end. */
export const SETTLE_WINDOW_ALERT_LEDGERS = 2 * DAY_LEDGERS
export const DEFAULT_TIP_LIMIT = 20
export const MAX_TIP_LIMIT = 50

const VOUCHER_SCAN = 1000
const SETTLEMENT_SCAN = 200

type Me = {
  userId: Doc<'users'>['_id']
  address: string
  chain: ReturnType<typeof readChainEnv>
}

async function me(ctx: QueryCtx): Promise<Me | null> {
  const userId = await getAuthUserId(ctx)
  if (!userId) return null
  const chain = readChainEnv()
  const user = await ctx.db.get(userId)
  const address = verifiedStellarAddress(user, chain.passphrase)
  return address ? { userId, address, chain } : null
}

/** The indexer's latest ledger, or null while it is not in step. */
async function latestLedger(
  ctx: QueryCtx,
  chain: Me['chain']
): Promise<number | null> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
  if (
    !cursor ||
    cursor.chainEpoch !== chain.chainEpoch ||
    cursor.latestLedger <= 0
  ) {
    return null
  }
  return cursor.latestLedger
}

function settlementEnabled(): boolean {
  return process.env.SETTLEMENT_ENABLED?.trim() === 'true'
}

/** True when an unsettled pair's key settle window ends within 2 days. */
function windowEndsSoon(
  vouchers: Doc<'tabVouchers'>[],
  ledger: number | null
): boolean {
  if (ledger === null) return false
  return vouchers.some(
    (row) =>
      row.state === 'ACTIVE' &&
      row.unsettled &&
      row.settleBy !== undefined &&
      row.settleBy - ledger <= SETTLE_WINDOW_ALERT_LEDGERS
  )
}

function oldestUnsettled(vouchers: Doc<'tabVouchers'>[]): number | null {
  let oldest: number | null = null
  for (const row of vouchers) {
    if (row.state !== 'ACTIVE' || !row.unsettled) continue
    const at = row.oldestUnsettledAt
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at
  }
  return oldest
}

async function eventTx(
  ctx: QueryCtx,
  eventId: string | undefined
): Promise<string | null> {
  if (!eventId) return null
  const event = await ctx.db
    .query('chainEvents')
    .withIndex('by_event_id', (q) => q.eq('eventId', eventId))
    .first()
  return event?.txHash ?? null
}

/**
 * The transaction that settled a receipt: its own `TabSettled` event or
 * settlement record when stored, else the pair's latest `TabSettled`, which
 * paid every receipt up to the pair's paid amount.
 */
async function settlementTx(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>,
  vouchers: Doc<'tabVouchers'>[]
): Promise<string | null> {
  const own = await eventTx(ctx, receipt.settledEventId)
  if (own) return own
  if (receipt.settlementId) {
    const settlement = await ctx.db.get(receipt.settlementId)
    if (settlement?.txHash) return settlement.txHash
  }
  const pair = vouchers.find(
    (v) =>
      v.keyId === receipt.keyId && v.writerAddress === receipt.writerAddress
  )
  if (!pair) return null
  const fromEvent = await eventTx(ctx, pair.lastSettledEventId)
  if (fromEvent) return fromEvent
  // Settled by the settler: its confirmed settlement lists the pair.
  const recent = await ctx.db
    .query('tabSettlements')
    .withIndex('by_status', (q) => q.eq('status', 'CONFIRMED'))
    .order('desc')
    .take(SETTLEMENT_SCAN)
  return recent.find((s) => s.voucherIds.includes(pair._id))?.txHash ?? null
}

export type TabTipRow = {
  receiptId: string
  status: Doc<'tabReceipts'>['status']
  /** Gross base units of this tip. */
  amount: string
  writer: string
  keyId: number
  seq: number
  articleTitle: string | null
  articleSlug: string | null
  authorName: string | null
  authorUsername: string | null
  highlight: boolean
  acceptedAt: number
  /** The settlement transaction, once the tip settled through the settler. */
  settledTxHash: string | null
}

/**
 * Whether this deployment settles tab tips. Convex signs acceptances only
 * while `SETTLEMENT_ENABLED=true` (`loadAcceptor`), so while it is off no
 * quick tip is accepted. Needs no tab and no sign-in: the screens state it
 * before a reader opens or tops up a tab.
 */
export const getTabSettlement = query({
  args: {},
  handler: async () => ({ settlementEnabled: settlementEnabled() }),
})

/**
 * The reader's latest tab tips, newest first, with the settlement health of
 * the reader's tab. Null when the caller has no verified address or no tab.
 */
export const getMyTabTips = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const caller = await me(ctx)
    if (!caller || !caller.chain.tabContractId) return null
    const account = await tabAccountForReader(
      ctx,
      caller.address,
      caller.chain.chainEpoch
    )
    if (!account || account.userId !== caller.userId) return null
    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? DEFAULT_TIP_LIMIT)),
      MAX_TIP_LIMIT
    )
    // Newest first from the index: a bounded page however many receipts exist.
    const latest = await ctx.db
      .query('tabReceipts')
      .withIndex('by_account_accepted', (q) =>
        q.eq('tabAccountId', account._id)
      )
      .order('desc')
      .take(limit)
    const vouchers = await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) => q.eq('tabAccountId', account._id))
      .take(VOUCHER_SCAN)
    const tips: TabTipRow[] = []
    for (const receipt of latest) {
      const row = await ctx.db.get(receipt.tipRowId)
      const author = await ctx.db.get(receipt.authorId)
      const settledTxHash =
        receipt.status === 'SETTLED'
          ? await settlementTx(ctx, receipt, vouchers)
          : null
      tips.push({
        receiptId: receipt._id,
        status: receipt.status,
        amount: receipt.amount,
        writer: receipt.writerAddress,
        keyId: receipt.keyId,
        seq: receipt.seq,
        articleTitle: row?.articleTitle ?? null,
        articleSlug: row?.articleSlug ?? null,
        authorName: author ? author.name || author.username || null : null,
        authorUsername: author?.username ?? null,
        highlight: receipt.highlightId !== undefined,
        acceptedAt: receipt.acceptedAt,
        settledTxHash,
      })
    }
    return {
      settlementEnabled: settlementEnabled(),
      oldestUnsettledAt: oldestUnsettled(vouchers),
      settleWindowEndsSoon: windowEndsSoon(
        vouchers,
        await latestLedger(ctx, caller.chain)
      ),
      tips,
    }
  },
})

/**
 * The writer's tab earnings, summed over every pair that pays the caller's
 * verified address in this epoch: settled gross, the platform fee and the
 * writer's net from indexed `TabSettled` events, what still waits for
 * settlement, and what the indexer saw collected through `Claimed`. The
 * amount claimable now is read from the Tab contract by the client.
 */
export const getMyTabEarnings = query({
  args: {},
  handler: async (ctx) => {
    const caller = await me(ctx)
    if (!caller) return null
    const vouchers = (
      await ctx.db
        .query('tabVouchers')
        .withIndex('by_writer', (q) => q.eq('writerAddress', caller.address))
        .take(VOUCHER_SCAN)
    ).filter((row) => row.chainEpoch === caller.chain.chainEpoch)
    let settledGross = BigInt(0)
    let earnedNet = BigInt(0)
    let pendingNet = BigInt(0)
    let unpaidPairs = 0
    let shortfallPairs = 0
    let shortfallNet = BigInt(0)
    for (const row of vouchers) {
      settledGross += BigInt(row.paidOnChain)
      earnedNet += BigInt(row.earnedNet)
      pendingNet += BigInt(row.pendingNet)
      if (row.state === 'UNPAID') unpaidPairs += 1
      // Skipped as SHORTFALL: waits for the reader to top up the tab.
      if (row.state === 'ACTIVE' && row.settleQueue === 'blocked') {
        shortfallPairs += 1
        shortfallNet += BigInt(row.pendingNet)
      }
    }
    const token = caller.chain.tokenContractId
    const earnings = await ctx.db
      .query('authorEarnings')
      .withIndex('by_user', (q) => q.eq('userId', caller.userId))
      .first()
    const collected =
      (token ? earnings?.collectedBaseUnits?.[token] : undefined) ?? '0'
    return {
      writerAddress: caller.address,
      tabContractId: caller.chain.tabContractId,
      tokenContractId: token,
      pairs: vouchers.length,
      settledGross: settledGross.toString(),
      fee: (settledGross - earnedNet).toString(),
      earnedNet: earnedNet.toString(),
      pendingNet: pendingNet.toString(),
      collected,
      unpaidPairs,
      shortfallPairs,
      shortfallNet: shortfallNet.toString(),
      settlementEnabled: settlementEnabled(),
      oldestUnsettledAt: oldestUnsettled(vouchers),
      settleWindowEndsSoon: windowEndsSoon(
        vouchers,
        await latestLedger(ctx, caller.chain)
      ),
    }
  },
})
