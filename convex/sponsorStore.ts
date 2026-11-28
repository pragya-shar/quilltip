/**
 * The fee sponsor's records (`convex/sponsor.ts` calls these): who asked,
 * what was prepared, and the limits. Internal, except one public query:
 * `passkeyTipAvailable`, a single boolean for the newcomer sheet.
 *
 * Every sponsored balance call is bound to the user who asked and to that
 * user's own verified passkey account; an account deploy is recorded the
 * same way with no user. A request moves through
 * reserved → prepared → submitting → pending (signed, hash stored BEFORE the
 * send) → sent, or to failed. So a request is submitted at most once, and a
 * transaction that may have reached the network is never recorded as failed
 * without the network's answer.
 *
 * The daily fee budget counts what was paid AND what is committed. An open
 * request (prepared and not expired, submitting or pending) commits the most
 * its envelope may cost: its cap plus the inclusion fee, then the signed
 * envelope's fee. A request is refused when that commitment would pass the
 * budget, so concurrent requests cannot overshoot it.
 */
import { ConvexError, v } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import { verifiedStellarAddress } from './lib/walletVerification'
import {
  PER_USER_PER_DAY,
  PER_USER_PER_HOUR,
  READINESS_TTL_MS,
  REQUEST_TTL_MS,
} from './lib/sponsor/policy'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

function sponsorError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

/** The UTC day a timestamp falls in, as `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

async function daySpent(ctx: MutationCtx, day: string) {
  const row = await ctx.db
    .query('sponsorDays')
    .withIndex('by_day', (q) => q.eq('day', day))
    .unique()
  return { row, spent: row ? BigInt(row.spentStroops) : BigInt(0) }
}

async function addDaySpent(ctx: MutationCtx, day: string, fee: bigint) {
  if (fee <= BigInt(0)) return
  const { row, spent } = await daySpent(ctx, day)
  const next = (spent + fee).toString()
  if (row) await ctx.db.patch(row._id, { spentStroops: next })
  else await ctx.db.insert('sponsorDays', { day, spentStroops: next })
}

/** Fees committed today but not yet paid: what open requests may still cost. */
async function dayCommitted(ctx: MutationCtx, day: string, now: number) {
  let sum = BigInt(0)
  for (const status of ['prepared', 'submitting', 'pending'] as const) {
    const rows = await ctx.db
      .query('sponsoredCalls')
      .withIndex('by_day_status', (q) => q.eq('day', day).eq('status', status))
      .collect()
    for (const r of rows) {
      if (status === 'prepared' && now >= r.expiresAt) continue
      sum += BigInt(r.feeStroops)
    }
  }
  return sum
}

async function checkCommit(
  ctx: MutationCtx,
  day: string,
  commit: bigint,
  budget: bigint,
  now: number
) {
  const { spent } = await daySpent(ctx, day)
  const committed = await dayCommitted(ctx, day, now)
  if (spent + committed + commit > budget) {
    sponsorError(
      'SPONSOR_BUDGET_REACHED',
      "Today's sponsored fees are used up."
    )
  }
}

function randomRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const keyValidator = v.union(
  v.null(),
  v.object({
    publicKey: v.string(),
    validUntil: v.number(),
    spendLimit: v.string(),
  })
)
const callValidator = v.union(
  v.literal('open_session'),
  v.literal('deposit'),
  v.literal('register_key'),
  v.literal('revoke_key')
)

/**
 * Checks the caller and the limits, then records the request. The reader is
 * always the caller's own verified contract address: a wallet (G) reader
 * pays its own fees and is refused here.
 */
export const reserve = internalMutation({
  args: {
    userId: v.id('users'),
    call: callValidator,
    amount: v.string(),
    key: keyValidator,
    keyId: v.union(v.null(), v.number()),
    passphrase: v.string(),
    dailyBudgetStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    const reader = verifiedStellarAddress(user, args.passphrase)
    if (!reader || !StrKey.isValidContract(reader)) {
      sponsorError(
        'SPONSOR_READER_NOT_PASSKEY',
        'Only a verified passkey account is sponsored.'
      )
    }
    const day = utcDay(args.now)
    const { spent } = await daySpent(ctx, day)
    if (
      spent + (await dayCommitted(ctx, day, args.now)) >=
      BigInt(args.dailyBudgetStroops)
    ) {
      sponsorError(
        'SPONSOR_BUDGET_REACHED',
        "Today's sponsored fees are used up."
      )
    }
    for (const [key, limit, windowMs] of [
      [`sponsor:hour:${args.userId}`, PER_USER_PER_HOUR, HOUR_MS],
      [`sponsor:day:${args.userId}`, PER_USER_PER_DAY, DAY_MS],
    ] as const) {
      const r = await consumeFixedWindow(ctx, key, limit, windowMs, args.now)
      if (!r.ok) {
        sponsorError(
          'SPONSOR_RATE_LIMITED',
          `Too many sponsored calls. Try again in ${Math.ceil(r.retryAfterMs / 60_000)} min.`
        )
      }
    }
    const requestId = randomRequestId()
    await ctx.db.insert('sponsoredCalls', {
      requestId,
      userId: args.userId,
      reader,
      call: args.call,
      amount: args.amount,
      key: args.key,
      keyId: args.keyId,
      status: 'reserved',
      entries: [],
      maxExpiration: 0,
      feeStroops: '0',
      day,
      expiresAt: args.now + REQUEST_TTL_MS,
      createdAt: args.now,
      updatedAt: args.now,
    })
    return { requestId, reader }
  },
})

async function byRequest(
  ctx: MutationCtx,
  requestId: string
): Promise<Doc<'sponsoredCalls'>> {
  const row = await ctx.db
    .query('sponsoredCalls')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .unique()
  if (!row) sponsorError('SPONSOR_UNKNOWN_REQUEST', 'Unknown request.')
  return row
}

/**
 * Stores the prepared entries and commits the most the call may cost
 * (`commitStroops`: its cap plus the inclusion fee) against the day.
 * Refused when that would pass the budget with everything already paid or
 * committed today.
 */
export const recordPrepared = internalMutation({
  args: {
    requestId: v.string(),
    entries: v.array(v.string()),
    maxExpiration: v.number(),
    commitStroops: v.string(),
    dailyBudgetStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status !== 'reserved') {
      sponsorError(
        'SPONSOR_BAD_STATE',
        'The request is not awaiting preparation.'
      )
    }
    await checkCommit(
      ctx,
      row.day,
      BigInt(args.commitStroops),
      BigInt(args.dailyBudgetStroops),
      args.now
    )
    await ctx.db.patch(row._id, {
      status: 'prepared',
      entries: args.entries,
      maxExpiration: args.maxExpiration,
      feeStroops: args.commitStroops,
      updatedAt: args.now,
    })
  },
})

/**
 * Records an account deploy before anything is signed: the same budget
 * check and commitment as a balance call, in one mutation.
 */
export const reserveDeploy = internalMutation({
  args: {
    reader: v.string(),
    commitStroops: v.string(),
    dailyBudgetStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const day = utcDay(args.now)
    await checkCommit(
      ctx,
      day,
      BigInt(args.commitStroops),
      BigInt(args.dailyBudgetStroops),
      args.now
    )
    const requestId = randomRequestId()
    await ctx.db.insert('sponsoredCalls', {
      requestId,
      reader: args.reader,
      call: 'deploy',
      amount: '0',
      key: null,
      keyId: null,
      status: 'submitting',
      entries: [],
      maxExpiration: 0,
      feeStroops: args.commitStroops,
      day,
      expiresAt: args.now + REQUEST_TTL_MS,
      createdAt: args.now,
      updatedAt: args.now,
    })
    return { requestId }
  },
})

/**
 * Hands a prepared request to exactly one submit: same user, not expired,
 * not claimed before.
 */
export const claim = internalMutation({
  args: { requestId: v.string(), userId: v.id('users'), now: v.number() },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (!row.userId || row.userId !== (args.userId as Id<'users'>)) {
      sponsorError('SPONSOR_UNKNOWN_REQUEST', 'Unknown request.')
    }
    if (row.status !== 'prepared') {
      sponsorError('SPONSOR_BAD_STATE', 'This request was already used.')
    }
    // A throw rolls the mutation back, so an expired row keeps its status;
    // it can never be claimed because the time check runs on every claim.
    if (args.now >= row.expiresAt) {
      sponsorError('SPONSOR_EXPIRED', 'The request expired. Nothing was sent.')
    }
    await ctx.db.patch(row._id, { status: 'submitting', updatedAt: args.now })
    return row
  },
})

/**
 * The envelope is signed and about to be sent: store its hash, its fee and
 * its time bound first. Throws unless the request is `submitting`, so a
 * transaction is never sent without this record.
 */
export const markSigned = internalMutation({
  args: {
    requestId: v.string(),
    txHash: v.string(),
    envelopeFee: v.string(),
    maxTime: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status !== 'submitting') {
      sponsorError('SPONSOR_BAD_STATE', 'The request is not being submitted.')
    }
    await ctx.db.patch(row._id, {
      status: 'pending',
      txHash: args.txHash,
      feeStroops: args.envelopeFee,
      maxTime: args.maxTime,
      updatedAt: args.now,
    })
  },
})

/** The result is known and succeeded: book the fee charged, once. */
export const finish = internalMutation({
  args: {
    requestId: v.string(),
    txHash: v.string(),
    feeStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status === 'sent' || row.status === 'failed') return
    await ctx.db.patch(row._id, {
      status: 'sent',
      txHash: args.txHash,
      feeStroops: args.feeStroops,
      updatedAt: args.now,
    })
    await addDaySpent(ctx, row.day, BigInt(args.feeStroops))
  },
})

/**
 * Closes a request as failed and releases its commitment. A request whose
 * transaction may have been sent (`pending`) is closed only with `force`:
 * when the node refused it, when the network answered FAILED (with the fee
 * charged), or when the node's clock is past its time bound with no trace.
 */
export const fail = internalMutation({
  args: {
    requestId: v.string(),
    error: v.string(),
    feeStroops: v.optional(v.string()),
    force: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status === 'sent' || row.status === 'failed') return
    if (row.status === 'pending' && !args.force) return
    await ctx.db.patch(row._id, {
      status: 'failed',
      error: args.error.slice(0, 120),
      feeStroops: args.feeStroops ?? '0',
      updatedAt: args.now,
    })
    // A transaction that reached the ledger and failed still cost a fee.
    if (args.feeStroops) {
      await addDaySpent(ctx, row.day, BigInt(args.feeStroops))
    }
  },
})

/**
 * What the reconciler closes, oldest first and from any day: every pending
 * request older than `olderThanMs`, and every request left in `submitting`
 * past the request lifetime (nothing was signed for those, so nothing can
 * land).
 */
export const openRows = internalQuery({
  args: { now: v.number(), olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('sponsoredCalls')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'pending').lt('updatedAt', args.now - args.olderThanMs)
      )
      .take(50)
    const abandoned = await ctx.db
      .query('sponsoredCalls')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'submitting').lt('updatedAt', args.now - REQUEST_TTL_MS)
      )
      .take(50)
    return {
      pending: pending.map((r) => ({
        requestId: r.requestId,
        txHash: r.txHash ?? null,
        maxTime: r.maxTime ?? 0,
      })),
      abandoned: abandoned.map((r) => r.requestId),
    }
  },
})

/** When the sponsor last had a call confirmed on chain, or null. */
export const lastGoodSubmit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('sponsoredCalls')
      .withIndex('by_status_updated', (q) => q.eq('status', 'sent'))
      .order('desc')
      .first()
    return row ? row.updatedAt : null
  },
})

// ----- Readiness -----

export const readiness = internalQuery({
  args: { service: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query('signerReadiness')
      .withIndex('by_service', (q) => q.eq('service', args.service))
      .unique(),
})

export const recordReadiness = internalMutation({
  args: {
    service: v.string(),
    ready: v.boolean(),
    failed: v.array(v.string()),
    warnings: v.array(v.string()),
    fingerprint: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('signerReadiness')
      .withIndex('by_service', (q) => q.eq('service', args.service))
      .unique()
    const doc = {
      service: args.service,
      ready: args.ready,
      failed: args.failed,
      warnings: args.warnings,
      fingerprint: args.fingerprint,
      checkedAt: args.now,
    }
    if (row) await ctx.db.patch(row._id, doc)
    else await ctx.db.insert('signerReadiness', doc)
  },
})

/**
 * The one public answer: can a first tip with a passkey go through now?
 * True only when the sponsor is switched on and its latest readiness check
 * passed within `READINESS_TTL_MS`. Nothing about why leaves the server.
 */
export const passkeyTipAvailable = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    if (process.env.SPONSOR_ENABLED?.trim() !== 'true') return false
    const row = await ctx.db
      .query('signerReadiness')
      .withIndex('by_service', (q) => q.eq('service', 'sponsor'))
      .unique()
    return !!row && row.ready && Date.now() - row.checkedAt < READINESS_TTL_MS
  },
})
