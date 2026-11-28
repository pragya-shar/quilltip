/**
 * The fee sponsor's records (`convex/sponsor.ts` calls these): who asked,
 * what was prepared, and the limits. Internal only: no client reaches them.
 *
 * Every sponsored balance call is bound to the user who asked and to that
 * user's own verified passkey account. It moves through
 * reserved → prepared → submitting → pending (sent, hash stored) → sent, or
 * to failed, so a request is submitted at most once and a transaction that
 * reached the network is never recorded as failed without its result.
 *
 * The daily fee budget counts what was paid AND what is committed: the
 * prepared fee of every request that is prepared (and not expired),
 * submitting or pending. A request is refused when its own prepared fee would
 * pass the budget, so concurrent requests cannot overshoot it.
 */
import { ConvexError, v } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import { verifiedStellarAddress } from './lib/walletVerification'
import {
  PER_USER_PER_DAY,
  PER_USER_PER_HOUR,
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

/** Fees committed today but not yet paid: open requests' prepared fees. */
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
 * Stores the prepared entries and commits the prepared fee against the day.
 * Refused when the fee would pass the budget with everything already paid or
 * committed today.
 */
export const recordPrepared = internalMutation({
  args: {
    requestId: v.string(),
    entries: v.array(v.string()),
    maxExpiration: v.number(),
    feeStroops: v.string(),
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
    const { spent } = await daySpent(ctx, row.day)
    const committed = await dayCommitted(ctx, row.day, args.now)
    if (
      spent + committed + BigInt(args.feeStroops) >
      BigInt(args.dailyBudgetStroops)
    ) {
      sponsorError(
        'SPONSOR_BUDGET_REACHED',
        "Today's sponsored fees are used up."
      )
    }
    await ctx.db.patch(row._id, {
      status: 'prepared',
      entries: args.entries,
      maxExpiration: args.maxExpiration,
      feeStroops: args.feeStroops,
      updatedAt: args.now,
    })
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
    if (row.userId !== (args.userId as Id<'users'>)) {
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
 * The network accepted the transaction: store its hash before any polling.
 * The envelope's fee (at most the cap) stays committed until the result.
 */
export const markSent = internalMutation({
  args: {
    requestId: v.string(),
    txHash: v.string(),
    envelopeFee: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status !== 'submitting') return
    await ctx.db.patch(row._id, {
      status: 'pending',
      txHash: args.txHash,
      feeStroops: args.envelopeFee,
      updatedAt: args.now,
    })
  },
})

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
 * Closes a request as failed. A request whose transaction was sent
 * (`pending`) is closed only with `force` (the reconciler, once the network
 * has answered or the time bound has passed), never by the submit path.
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
      ...(args.feeStroops ? { feeStroops: args.feeStroops } : {}),
      updatedAt: args.now,
    })
    // A transaction that reached the ledger and failed still cost a fee.
    if (args.feeStroops) {
      await addDaySpent(ctx, row.day, BigInt(args.feeStroops))
    }
  },
})

/** Pending requests older than `olderThanMs`, for the reconciler. */
export const stalePending = internalQuery({
  args: { now: v.number(), olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const days = [utcDay(args.now), utcDay(args.now - DAY_MS)]
    const out: { requestId: string; txHash: string; updatedAt: number }[] = []
    for (const day of days) {
      const rows = await ctx.db
        .query('sponsoredCalls')
        .withIndex('by_day_status', (q) =>
          q.eq('day', day).eq('status', 'pending')
        )
        .take(50)
      for (const r of rows) {
        if (r.txHash && args.now - r.updatedAt >= args.olderThanMs) {
          out.push({
            requestId: r.requestId,
            txHash: r.txHash,
            updatedAt: r.updatedAt,
          })
        }
      }
    }
    return out
  },
})

/** Counts a fee paid outside a request (an account deploy) against the day. */
export const recordFee = internalMutation({
  args: { feeStroops: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await addDaySpent(ctx, utcDay(args.now), BigInt(args.feeStroops))
  },
})

/** Refuses when today's budget is used up (the deploy path checks this first). */
export const checkBudget = internalMutation({
  args: { dailyBudgetStroops: v.string(), now: v.number() },
  handler: async (ctx, args) => {
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
  },
})
